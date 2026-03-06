// ExtendScript for Premiere Pro Multicam Auto-Cut
// This script applies camera cuts to a multicam sequence based on JSON cut list

// Enable QE DOM for advanced scripting
app.enableQE();

/**
 * Validate JSON path to prevent path traversal
 *
 * @param {string} jsonPath - Path to validate
 * @returns {boolean} True if path is valid
 */
function validateJsonPath(jsonPath) {
    // Check for path traversal attempts
    if (jsonPath.indexOf('..') !== -1) {
        return false;
    }

    // Ensure path is in temp directory
    var isTempPath = jsonPath.indexOf('/tmp/') !== -1 ||
                     jsonPath.indexOf('\\Temp\\') !== -1 ||
                     jsonPath.indexOf('/var/folders/') !== -1;  // macOS temp

    if (!isTempPath) {
        return false;
    }

    // Check file extension
    if (jsonPath.slice(-5) !== '.json') {
        return false;
    }

    return true;
}

/**
 * Apply multicam cuts to active sequence
 *
 * @param {string} jsonPath - Absolute path to JSON file containing cut list
 * @returns {object} Result object with success status and details
 */
function applyMulticamCuts(jsonPath) {
    var result = {
        success: false,
        error: null,
        cutsApplied: 0,
        sequenceName: null
    };

    try {
        // Validate JSON path
        if (!validateJsonPath(jsonPath)) {
            result.error = "無効なJSONファイルパスです";
            return JSON.stringify(result);
        }

        // Validate JSON file exists
        var jsonFile = new File(jsonPath);
        if (!jsonFile.exists) {
            result.error = "カットリストファイルが見つかりません";
            return JSON.stringify(result);
        }

        // Read and parse JSON
        var cutData;
        try {
            jsonFile.open('r');
            var jsonText = jsonFile.read();
            jsonFile.close();
            cutData = JSON.parse(jsonText);
        } catch (e) {
            result.error = "JSONファイルの読み込みに失敗しました: " + e.toString();
            return JSON.stringify(result);
        }

        // Validate JSON structure
        if (!cutData.cuts || !cutData.cuts.length) {
            result.error = "カットリストが空です";
            return JSON.stringify(result);
        }

        // Get active sequence
        var activeSequence = app.project.activeSequence;
        if (!activeSequence) {
            result.error = "アクティブなシーケンスがありません。シーケンスを開いてください";
            return JSON.stringify(result);
        }

        result.sequenceName = activeSequence.name;

        // Get QE sequence for advanced operations
        var qeSequence = qe.project.getActiveSequence();
        if (!qeSequence) {
            result.error = "QEシーケンスの取得に失敗しました";
            return JSON.stringify(result);
        }

        try {
            // NEW APPROACH: Set keyframes on multicam clip instead of using razor
            var cuts = cutData.cuts;

            // Debug: Write log to file (use Desktop for easier access)
            var logPath = "~/Desktop/multicam_debug.log";
            var logFile = new File(logPath);
            if (!logFile.open('w')) {
                $.writeln("ERROR: Failed to open log file at " + logPath);
                result.error = "ログファイルの作成に失敗しました";
                return JSON.stringify(result);
            }
            logFile.writeln("=== Multicam Keyframe Approach ===");
            logFile.writeln("Total cuts: " + cuts.length);
            logFile.writeln("");

            // Get the multicam clip
            var videoTracks = activeSequence.videoTracks;
            if (videoTracks.numTracks === 0) {
                throw new Error("シーケンスにビデオトラックがありません");
            }

            var multicamTrack = videoTracks[0];
            if (multicamTrack.clips.numItems === 0) {
                throw new Error("V1トラックにクリップがありません");
            }

            var clip = multicamTrack.clips[0]; // Assuming single multicam clip
            logFile.writeln("Clip name: " + clip.name);
            logFile.writeln("Clip type: " + clip.projectItem.type);
            logFile.writeln("");

            // Find the Multicam effect component
            var components = clip.components;
            logFile.writeln("Total components: " + components.numItems);

            var multicamComponent = null;
            for (var i = 0; i < components.numItems; i++) {
                var component = components[i];
                logFile.writeln("Component " + i + ": " + component.displayName);

                // Look for multicam-related component
                if (component.displayName.indexOf("Multicam") !== -1 ||
                    component.displayName.indexOf("マルチカメラ") !== -1) {
                    multicamComponent = component;
                    logFile.writeln("  -> Found multicam component!");
                    break;
                }
            }

            if (!multicamComponent) {
                logFile.writeln("");
                logFile.writeln("ERROR: Multicam component not found");
                logFile.close();
                throw new Error("マルチカメラコンポーネントが見つかりませんでした");
            }

            // Find the camera selection property
            var properties = multicamComponent.properties;
            logFile.writeln("");
            logFile.writeln("Multicam component properties: " + properties.numItems);

            var cameraProperty = null;
            for (var i = 0; i < properties.numItems; i++) {
                var prop = properties[i];
                logFile.writeln("Property " + i + ": " + prop.displayName);

                // Look for camera/angle selection property
                if (prop.displayName.indexOf("Camera") !== -1 ||
                    prop.displayName.indexOf("Angle") !== -1 ||
                    prop.displayName.indexOf("カメラ") !== -1 ||
                    prop.displayName.indexOf("アングル") !== -1) {
                    cameraProperty = prop;
                    logFile.writeln("  -> Found camera property!");
                    break;
                }
            }

            if (!cameraProperty) {
                logFile.writeln("");
                logFile.writeln("ERROR: Camera property not found");
                logFile.close();
                throw new Error("カメラ選択プロパティが見つかりませんでした");
            }

            // Set keyframes for each cut
            logFile.writeln("");
            logFile.writeln("Setting keyframes...");

            var keyframesSet = 0;
            for (var i = 0; i < cuts.length; i++) {
                var cut = cuts[i];
                var timeTicks = secondsToTicks(cut.startTime);
                var camera = cut.camera;

                try {
                    // Camera angles in Premiere are 1-indexed (1, 2, 3...)
                    cameraProperty.setValueAtTime(timeTicks, camera);
                    keyframesSet++;

                    if (i < 5 || i >= cuts.length - 5) {
                        logFile.writeln("Keyframe " + i + ": camera=" + camera + " at " + cut.startTime + "s");
                    }
                } catch (e) {
                    logFile.writeln("ERROR setting keyframe " + i + ": " + e.toString());
                    if (keyframesSet === 0 && i < 10) {
                        // Log first few errors in detail
                        $.writeln("Failed to set keyframe at " + cut.startTime + "s: " + e.toString());
                    }
                }
            }

            result.cutsApplied = keyframesSet;
            logFile.writeln("");
            logFile.writeln("Total keyframes set: " + keyframesSet);
            logFile.close();

            result.success = true;

        } catch (e) {
            result.error = "カット割適用中にエラーが発生しました: " + e.toString();
        }

    } catch (e) {
        result.error = "予期しないエラー: " + e.toString();
    }

    return JSON.stringify(result);
}

/**
 * Convert seconds to ticks (Premiere Pro time unit)
 *
 * @param {number} seconds - Time in seconds
 * @returns {string} Time in ticks as string
 */
function secondsToTicks(seconds) {
    // Premiere Pro ticks: 254016000000 ticks per second
    var ticksPerSecond = 254016000000;
    var ticks = Math.round(seconds * ticksPerSecond);
    return ticks.toString();
}

/**
 * Find clip at specific time on a track
 *
 * @param {TrackItem} track - Video or audio track
 * @param {string} timeTicks - Time in ticks as string
 * @returns {TrackItem|null} Clip at specified time or null
 */
function findClipAtTime(track, timeTicks) {
    var time = parseFloat(timeTicks);

    for (var i = 0; i < track.clips.numItems; i++) {
        var clip = track.clips[i];
        var clipStart = parseFloat(clip.start.ticks);
        var clipEnd = parseFloat(clip.end.ticks);

        // Check if time falls within clip bounds
        if (time >= clipStart && time < clipEnd) {
            return clip;
        }
    }

    return null;
}

/**
 * Test function to verify ExtendScript is working
 *
 * @returns {string} Test message
 */
function testExtendScript() {
    var result = {
        success: true,
        message: "ExtendScript is working",
        hasActiveSequence: app.project.activeSequence !== null,
        qeEnabled: typeof qe !== 'undefined'
    };
    return JSON.stringify(result);
}
