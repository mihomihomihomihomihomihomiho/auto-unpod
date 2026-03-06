// CEP Orchestration Logic for Multicam Auto-Cut
// This module handles UI interactions, Python process spawning, and ExtendScript calls

// Global state
let csInterface = null;
let speaker1File = null;
let speaker2File = null;

// Initialize CSInterface on load
window.addEventListener('load', function() {
    csInterface = new CSInterface();
    logInfo('拡張機能が読み込まれました');
});

// File selection handler
function selectFile(speakerType) {
    if (!csInterface) {
        logError('CSInterface が初期化されていません');
        return;
    }

    // Open file dialog for WAV files
    const result = window.cep.fs.showOpenDialog(
        false, // allowMultipleSelection
        false, // chooseDirectory
        'WAVファイルを選択',
        null, // defaultPath
        ['wav'] // fileTypes
    );

    if (result.err === window.cep.fs.NO_ERROR && result.data && result.data.length > 0) {
        const filePath = result.data[0];

        // Validate file
        if (!validateFile(filePath)) {
            return;
        }

        // Store file path and update UI
        if (speakerType === 'speaker1') {
            speaker1File = filePath;
            updateFilePathDisplay('speaker1Path', filePath);
            logInfo('話者1ファイル選択: ' + getFileName(filePath));
        } else if (speakerType === 'speaker2') {
            speaker2File = filePath;
            updateFilePathDisplay('speaker2Path', filePath);
            logInfo('話者2ファイル選択: ' + getFileName(filePath));
        }
    }
}

// Validate selected file
function validateFile(filePath) {
    // Check if file exists
    const fileInfo = window.cep.fs.stat(filePath);
    if (fileInfo.err !== window.cep.fs.NO_ERROR) {
        logError('ファイルが見つかりません: ' + filePath);
        return false;
    }

    // Check if it's a file (not directory)
    if (fileInfo.data.isDirectory()) {
        logError('ディレクトリではなくファイルを選択してください');
        return false;
    }

    // Check .wav extension
    if (!filePath.toLowerCase().endsWith('.wav')) {
        logError('WAVファイルを選択してください (.wav)');
        return false;
    }

    return true;
}

// Update file path display
function updateFilePathDisplay(elementId, filePath) {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = filePath;
        element.classList.remove('empty');
    }
}

// Get filename from path
function getFileName(filePath) {
    return filePath.split(/[\\/]/).pop();
}

// Update threshold slider display
function updateThreshold() {
    const slider = document.getElementById('threshold');
    const display = document.getElementById('thresholdValue');
    if (slider && display) {
        display.textContent = slider.value + ' dBFS';
    }
}

// Update min duration slider display
function updateMinDuration() {
    const slider = document.getElementById('minDuration');
    const display = document.getElementById('minDurationValue');
    if (slider && display) {
        display.textContent = parseFloat(slider.value).toFixed(1) + ' 秒';
    }
}

// Validate numeric threshold value
function validateThreshold(value) {
    const num = parseFloat(value);
    if (isNaN(num) || !isFinite(num)) {
        return { valid: false, error: '閾値は有効な数値である必要があります' };
    }
    if (num < -50 || num > -20) {
        return { valid: false, error: '閾値は -50 から -20 の範囲である必要があります' };
    }
    return { valid: true, value: num };
}

// Validate numeric min duration value
function validateMinDuration(value) {
    const num = parseFloat(value);
    if (isNaN(num) || !isFinite(num)) {
        return { valid: false, error: '最小継続時間は有効な数値である必要があります' };
    }
    if (num < 0.5 || num > 3.0) {
        return { valid: false, error: '最小継続時間は 0.5 から 3.0 秒の範囲である必要があります' };
    }
    return { valid: true, value: num };
}

// Execute auto-cut workflow
async function executeAutoCut() {
    // Validate inputs
    if (!speaker1File || !speaker2File) {
        logError('両方の音声ファイルを選択してください');
        return;
    }

    // Get and validate parameters
    const thresholdResult = validateThreshold(document.getElementById('threshold').value);
    if (!thresholdResult.valid) {
        logError(thresholdResult.error);
        return;
    }

    const minDurationResult = validateMinDuration(document.getElementById('minDuration').value);
    if (!minDurationResult.valid) {
        logError(minDurationResult.error);
        return;
    }

    const threshold = thresholdResult.value;
    const minDuration = minDurationResult.value;

    // Disable execute button
    const executeBtn = document.getElementById('executeBtn');
    executeBtn.disabled = true;

    // Show progress
    showProgress();
    setProgress(0, '処理を開始しています...');

    try {
        // Step 1: Run Python analysis
        logInfo('音声解析を開始します...');
        const cutListPath = await runPythonAnalysis(speaker1File, speaker2File, threshold, minDuration);

        if (!cutListPath) {
            throw new Error('音声解析が失敗しました');
        }

        setProgress(70, 'カット割を適用しています...');
        logInfo('Premiere Pro にカット割を適用します...');

        // Step 2: Apply cuts via ExtendScript
        const result = await applyMulticamCuts(cutListPath);

        if (result.success) {
            setProgress(100, '完了');
            logSuccess('自動カット割が完了しました: ' + result.cutsApplied + ' カット');
            cleanupTempFiles();
        } else {
            throw new Error(result.error || '不明なエラー');
        }

    } catch (error) {
        const sanitizedError = sanitizeError(error.message);
        console.error('Execution error:', error); // Keep full error for debugging
        logError('エラー: ' + sanitizedError);
        setProgress(0, 'エラー');
        cleanupTempFiles();
    } finally {
        executeBtn.disabled = false;
    }
}

// Sanitize file path to prevent command injection
function sanitizePath(filePath) {
    // Check for path traversal attempts
    if (filePath.includes('..')) {
        throw new Error('パスに ".." を含めることはできません');
    }

    // Check for dangerous shell characters
    const dangerousChars = /[;&|`$(){}[\]<>]/;
    if (dangerousChars.test(filePath)) {
        throw new Error('パスに無効な文字が含まれています');
    }

    // Ensure absolute path
    const nodeRequire = window.require || require;
    const path = nodeRequire('path');
    if (!path.isAbsolute(filePath)) {
        throw new Error('絶対パスである必要があります');
    }

    return filePath;
}

// Sanitize error messages for user display
function sanitizeError(errorMsg) {
    if (!errorMsg) return '不明なエラーが発生しました';

    // Remove file paths
    let sanitized = errorMsg.replace(/[/\\][^\s]+/g, '[ファイルパス]');

    // Remove usernames
    sanitized = sanitized.replace(/\/Users\/[^/\s]+/g, '/Users/[ユーザー名]');
    sanitized = sanitized.replace(/C:\\Users\\[^\\/\s]+/g, 'C:\\Users\\[ユーザー名]');

    return sanitized;
}

// Track temp files for cleanup
let tempFiles = [];

// Cleanup temp files
function cleanupTempFiles() {
    const nodeRequire = window.require || require;
    const fs = nodeRequire('fs');

    for (const filePath of tempFiles) {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log('Cleaned up temp file:', filePath);
            }
        } catch (err) {
            console.warn('Failed to cleanup temp file:', filePath, err);
        }
    }
    tempFiles = [];
}

// Run Python analysis
function runPythonAnalysis(file1, file2, threshold, minDuration) {
    return new Promise((resolve, reject) => {
        const nodeRequire = window.require || require;
        const childProcess = nodeRequire('child_process');
        const path = nodeRequire('path');
        const os = nodeRequire('os');

        // Sanitize file paths
        let sanitizedFile1, sanitizedFile2;
        try {
            sanitizedFile1 = sanitizePath(file1);
            sanitizedFile2 = sanitizePath(file2);
        } catch (err) {
            reject(new Error('ファイルパスの検証に失敗しました: ' + err.message));
            return;
        }

        // Get extension path
        const extensionPath = csInterface.getSystemPath(SystemPath.EXTENSION);
        const pythonScriptPath = path.join(extensionPath, 'python', 'analyze.py');

        // Create temp output path
        const outputPath = path.join(os.tmpdir(), 'multicam_cuts_' + Date.now() + '.json');
        tempFiles.push(outputPath);

        // Build command arguments
        const args = [
            pythonScriptPath,
            '--speaker1', sanitizedFile1,
            '--speaker2', sanitizedFile2,
            '--threshold', threshold.toString(),
            '--min-duration', minDuration.toString(),
            '--output', outputPath
        ];

        // Try python3 first, then python
        let pythonCmd = 'python3';
        let process = null;
        let processTimeout = null;
        const PROCESS_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

        try {
            process = childProcess.spawn(pythonCmd, args);
        } catch (err) {
            logWarning('python3 が見つかりません。python を試します...');
            pythonCmd = 'python';
            try {
                process = childProcess.spawn(pythonCmd, args);
            } catch (err2) {
                cleanupTempFiles();
                reject(new Error('Python が見つかりません。Python 3.7+ をインストールしてください'));
                return;
            }
        }

        // Set timeout for Python process
        processTimeout = setTimeout(() => {
            if (process && !process.killed) {
                process.kill('SIGTERM');
                cleanupTempFiles();
                reject(new Error('処理がタイムアウトしました (5分)'));
            }
        }, PROCESS_TIMEOUT_MS);

        let stdoutData = '';
        let stderrData = '';

        // Handle stdout (progress updates)
        process.stdout.on('data', (data) => {
            stdoutData += data.toString();

            // Parse JSON lines for progress
            const lines = stdoutData.split('\n');
            for (let i = 0; i < lines.length - 1; i++) {
                const line = lines[i].trim();
                if (line.startsWith('{')) {
                    try {
                        const progressData = JSON.parse(line);
                        if (progressData.progress !== undefined) {
                            const percentage = Math.round(progressData.progress * 70); // 0-70% for Python phase
                            setProgress(percentage, progressData.message || '解析中...');
                        }
                        if (progressData.message) {
                            logInfo(progressData.message);
                        }
                    } catch (e) {
                        // Not JSON, ignore
                    }
                }
            }
            stdoutData = lines[lines.length - 1]; // Keep incomplete line
        });

        // Handle stderr
        process.stderr.on('data', (data) => {
            stderrData += data.toString();
        });

        // Handle process exit
        process.on('close', (code) => {
            if (processTimeout) {
                clearTimeout(processTimeout);
            }

            if (code === 0) {
                // Success - verify output file exists
                const fileInfo = window.cep.fs.stat(outputPath);
                if (fileInfo.err === window.cep.fs.NO_ERROR) {
                    resolve(outputPath);
                } else {
                    cleanupTempFiles();
                    reject(new Error('出力ファイルが作成されませんでした'));
                }
            } else {
                // Error - sanitize error message for user
                const sanitizedError = sanitizeError(stderrData || '音声解析中にエラーが発生しました');
                console.error('Python stderr:', stderrData); // Keep full error for debugging
                cleanupTempFiles();
                reject(new Error(sanitizedError));
            }
        });

        // Handle process error
        process.on('error', (err) => {
            if (processTimeout) {
                clearTimeout(processTimeout);
            }
            const sanitizedError = sanitizeError(err.message);
            console.error('Process error:', err); // Keep full error for debugging
            cleanupTempFiles();
            reject(new Error('Python プロセスの起動に失敗しました: ' + sanitizedError));
        });
    });
}

// Apply multicam cuts via ExtendScript
function applyMulticamCuts(jsonPath) {
    return new Promise((resolve, reject) => {
        // Build ExtendScript call
        const script = `applyMulticamCuts('${jsonPath.replace(/\\/g, '\\\\')}')`;

        csInterface.evalScript(script, (result) => {
            if (!result || result === 'undefined') {
                reject(new Error('ExtendScript の実行に失敗しました'));
                return;
            }

            try {
                const resultObj = JSON.parse(result);
                resolve(resultObj);
            } catch (e) {
                reject(new Error('ExtendScript の結果解析に失敗しました: ' + result));
            }
        });
    });
}

// Progress management
function showProgress() {
    const container = document.getElementById('progressContainer');
    if (container) {
        container.classList.add('visible');
    }
}

function setProgress(percentage, message) {
    const fill = document.getElementById('progressFill');
    if (fill) {
        fill.style.width = percentage + '%';
        fill.textContent = message || (percentage + '%');
    }
}

// Logging functions
function logInfo(message) {
    addLogEntry(message, 'info');
}

function logSuccess(message) {
    addLogEntry(message, 'success');
}

function logWarning(message) {
    addLogEntry(message, 'warning');
}

function logError(message) {
    addLogEntry(message, 'error');
}

function addLogEntry(message, type) {
    const container = document.getElementById('logContainer');
    if (!container) return;

    const entry = document.createElement('div');
    entry.className = 'log-entry ' + type;

    const timestamp = new Date().toLocaleTimeString('ja-JP');
    entry.textContent = '[' + timestamp + '] ' + message;

    container.appendChild(entry);
    container.scrollTop = container.scrollHeight;
}
