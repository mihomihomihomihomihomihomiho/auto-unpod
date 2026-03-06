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
            // Process from beginning this time
            var videoTracks = activeSequence.videoTracks;
            if (videoTracks.numTracks === 0) {
                throw new Error("シーケンスにビデオトラックがありません");
            }

            // Find the multicam track (usually V1)
            var multicamTrack = videoTracks[0];

            for (var i = 0; i < cuts.length; i++) {
                var segment = cuts[i];
                var startTicks = secondsToTicks(segment.startTime);
                var camera = segment.camera;

                try {
                    // Find clip at this time on multicam track
                    var clip = findClipAtTime(multicamTrack, startTicks);

                    if (clip && clip.projectItem) {
                        // Check if it's a multicam clip
                        if (clip.projectItem.type === ProjectItemType.CLIP) {
                            // Set multicam angle
                            // Note: Camera angles are 0-indexed in API
                            var angleIndex = camera - 1;

                            try {
                                clip.projectItem.setActiveMultiCamAngle(angleIndex);
                                result.cutsApplied++;
                            } catch (e) {
                                // This clip might not be multicam, or angle doesn't exist
                                $.writeln("Warning: Failed to set camera angle for clip at " + segment.startTime + "s: " + e.toString());
                            }
                        }
                    }
                } catch (e) {
                    $.writeln("Warning: Failed to process segment at " + segment.startTime + "s: " + e.toString());
                }
            }

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
