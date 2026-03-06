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
            // Process cuts from end to beginning to avoid offset issues
            var cuts = cutData.cuts;
            var cutsToApply = [];

            // Collect all cut points (skip first cut at 0.0)
            for (var i = 1; i < cuts.length; i++) {
                var cutTime = cuts[i].startTime;
                cutsToApply.push({
                    time: cutTime,
                    camera: cuts[i].camera,
                    index: i
                });
            }

            // Sort by time (descending) to process from end to beginning
            cutsToApply.sort(function(a, b) {
                return b.time - a.time;
            });

            // Apply razor cuts
            for (var i = 0; i < cutsToApply.length; i++) {
                var cut = cutsToApply[i];
                var timeTicks = secondsToTicks(cut.time);

                try {
                    // Apply razor at cut point
                    qeSequence.razor(timeTicks);
                } catch (e) {
                    // Log error but continue with other cuts
                    $.writeln("Warning: Failed to apply cut at " + cut.time + "s: " + e.toString());
                }
            }

            // Now assign camera angles to segments
            // After applying razor cuts, iterate through all clips on the track
            var videoTracks = activeSequence.videoTracks;
            if (videoTracks.numTracks === 0) {
                throw new Error("シーケンスにビデオトラックがありません");
            }

            // Find the multicam track (usually V1)
            var multicamTrack = videoTracks[0];
            var numClips = multicamTrack.clips.numItems;

            $.writeln("Processing " + numClips + " clips on track");

            // Debug: Write log to file (use Desktop for easier access)
            var logPath = "~/Desktop/multicam_debug.log";
            var logFile = new File(logPath);
            if (!logFile.open('w')) {
                $.writeln("ERROR: Failed to open log file at " + logPath);
                result.error = "ログファイルの作成に失敗しました";
                return JSON.stringify(result);
            }
            logFile.writeln("=== Multicam Angle Switching Debug ===");
            logFile.writeln("Total clips: " + numClips);
            logFile.writeln("");

            // Process each clip on the timeline
            for (var clipIndex = 0; clipIndex < numClips; clipIndex++) {
                try {
                    var clip = multicamTrack.clips[clipIndex];
                    var clipStartTicks = parseFloat(clip.start.ticks);

                    // Find which camera should be active at this clip's start time
                    var targetCamera = 1; // default
                    for (var cutIndex = cuts.length - 1; cutIndex >= 0; cutIndex--) {
                        var cutStartTicks = parseFloat(secondsToTicks(cuts[cutIndex].startTime));
                        if (clipStartTicks >= cutStartTicks) {
                            targetCamera = cuts[cutIndex].camera;
                            break;
                        }
                    }

                    logFile.writeln("Clip " + clipIndex + ": target camera = " + targetCamera);

                    // Camera angles are 0-indexed (camera 1 = index 0)
                    var angleIndex = targetCamera - 1;

                    try {
                        // Use standard ExtendScript API for multicam clips
                        logFile.writeln("  Clip type: " + clip.projectItem.type);
                        logFile.writeln("  Has projectItem: " + (clip.projectItem !== null));

                        if (clip.projectItem && clip.projectItem.type === ProjectItemType.CLIP) {
                            // Check if it's a multicam clip
                            var isMulticam = false;
                            try {
                                // Try to access multicam properties
                                if (clip.multicamClip) {
                                    isMulticam = true;
                                    logFile.writeln("  Is multicam: true (has multicamClip property)");

                                    // Set the active angle
                                    clip.multicamClip.activeAngle = angleIndex;
                                    result.cutsApplied++;
                                    logFile.writeln("  SUCCESS: Set activeAngle to " + angleIndex);
                                }
                            } catch (mcError) {
                                logFile.writeln("  Error checking multicam: " + mcError.toString());
                            }

                            if (!isMulticam) {
                                // Try alternative approach: use projectItem
                                try {
                                    if (typeof clip.projectItem.setMulticamActiveAngle === 'function') {
                                        clip.projectItem.setMulticamActiveAngle(angleIndex);
                                        result.cutsApplied++;
                                        logFile.writeln("  SUCCESS: Used setMulticamActiveAngle()");
                                    } else {
                                        logFile.writeln("  No multicam methods found on projectItem");
                                    }
                                } catch (piError) {
                                    logFile.writeln("  Error with projectItem: " + piError.toString());
                                }
                            }
                        } else {
                            logFile.writeln("  Not a clip type or no projectItem");
                        }
                    } catch (e) {
                        $.writeln("Warning: Failed to set angle for clip " + clipIndex + ": " + e.toString());
                        logFile.writeln("  EXCEPTION: " + e.toString());
                    }
                } catch (e) {
                    $.writeln("Warning: Failed to process clip " + clipIndex + ": " + e.toString());
                    logFile.writeln("EXCEPTION processing clip " + clipIndex + ": " + e.toString());
                }
            }

            logFile.writeln("");
            logFile.writeln("Total cuts applied: " + result.cutsApplied);
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
