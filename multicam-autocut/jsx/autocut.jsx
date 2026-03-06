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

            // Debug log to file - avoid encoding issues by only writing ASCII
            var logFile = new File("~/Desktop/multicam_debug2.log");
            logFile.open('w');
            logFile.writeln("=== Multicam Keyframe Approach v2 ===");
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
            logFile.writeln("Clip type: " + clip.projectItem.type);

            // Find the Multicam effect component
            var components = clip.components;
            logFile.writeln("Total components: " + components.numItems);
            logFile.writeln("");

            // Strategy: Try each component and see if it has properties that look like camera controls
            var multicamComponent = null;
            var cameraProperty = null;

            for (var i = 0; i < components.numItems; i++) {
                var component = components[i];
                logFile.writeln("Component " + i + ":");
                logFile.writeln("  matchName: " + component.matchName);

                var props = component.properties;
                logFile.writeln("  properties count: " + props.numItems);

                // Check each property
                for (var j = 0; j < props.numItems; j++) {
                    var prop = props[j];
                    logFile.writeln("    Property " + j + ":");
                    logFile.writeln("      matchName: " + prop.matchName);

                    // Try to check if this is a camera property by examining matchName (ASCII)
                    var matchNameLower = prop.matchName.toLowerCase();
                    if (matchNameLower.indexOf("camera") !== -1 ||
                        matchNameLower.indexOf("angle") !== -1 ||
                        matchNameLower.indexOf("multicam") !== -1) {
                        logFile.writeln("      -> FOUND CAMERA PROPERTY!");
                        multicamComponent = component;
                        cameraProperty = prop;
                        break;
                    }
                }

                if (cameraProperty !== null) {
                    logFile.writeln("  -> Selected component " + i + " as multicam component");
                    break;
                }
                logFile.writeln("");
            }

            // If we couldn't find by matchName, try the first property of each component
            if (cameraProperty === null) {
                logFile.writeln("Could not find by matchName, trying first property of each component...");
                for (var i = 0; i < components.numItems; i++) {
                    var component = components[i];
                    if (component.properties.numItems > 0) {
                        logFile.writeln("Trying component " + i + ", property 0");
                        multicamComponent = component;
                        cameraProperty = component.properties[0];
                        break;
                    }
                }
            }

            if (!cameraProperty) {
                logFile.writeln("");
                logFile.writeln("ERROR: Could not find any suitable property");
                logFile.close();
                throw new Error("カメラ選択プロパティが見つかりませんでした");
            }

            // Set keyframes for each cut
            logFile.writeln("");
            logFile.writeln("Attempting to set keyframes on property...");

            var keyframesSet = 0;
            var firstError = null;

            for (var i = 0; i < cuts.length; i++) {
                var cut = cuts[i];
                var timeTicks = secondsToTicks(cut.startTime);
                var camera = cut.camera;

                try {
                    // Camera angles in Premiere are 1-indexed (1, 2, 3...)
                    cameraProperty.setValueAtTime(timeTicks, camera);
                    keyframesSet++;

                    if (i < 3) {
                        logFile.writeln("Keyframe " + i + ": camera=" + camera + " at " + cut.startTime + "s - SUCCESS");
                    }
                } catch (e) {
                    if (firstError === null) {
                        firstError = e.toString();
                        logFile.writeln("ERROR setting keyframe " + i + ": " + e.toString());
                    }
                }
            }

            result.cutsApplied = keyframesSet;
            logFile.writeln("");
            logFile.writeln("Total keyframes set: " + keyframesSet);
            if (firstError !== null) {
                logFile.writeln("First error: " + firstError);
            }
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
