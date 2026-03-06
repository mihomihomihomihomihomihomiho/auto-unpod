#!/usr/bin/env python3
"""
Multicam Auto-Cut Audio Analyzer

Analyzes two audio tracks to detect speaker activity and generate camera switching cuts.
Uses RMS energy in dBFS to detect voice activity and assigns camera angles based on
which speaker(s) are active.

Dependencies: librosa, numpy
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np

# Maximum file size: 500MB
MAX_FILE_SIZE_MB = 500
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024


def validate_file_size(filepath):
    """
    Validate that file size is within acceptable limits

    Args:
        filepath: Path to file

    Raises:
        Exception: If file is too large
    """
    file_path = Path(filepath)
    file_size = file_path.stat().st_size

    if file_size > MAX_FILE_SIZE_BYTES:
        size_mb = file_size / (1024 * 1024)
        raise Exception(f"ファイルサイズが大きすぎます: {size_mb:.1f}MB (最大: {MAX_FILE_SIZE_MB}MB)")


def emit_progress(progress, message):
    """Emit progress update as JSON line to stdout"""
    print(json.dumps({"progress": progress, "message": message}), flush=True)


def load_audio(filepath):
    """
    Load audio file and return waveform + sample rate

    Args:
        filepath: Path to WAV file

    Returns:
        tuple: (audio_data, sample_rate)

    Raises:
        Exception: If file cannot be loaded
    """
    try:
        import librosa

        # Load with original sample rate, convert to mono
        audio, sr = librosa.load(filepath, sr=None, mono=True)
        return audio, sr
    except ImportError:
        raise Exception("librosa が見つかりません。pip install librosa でインストールしてください")
    except Exception as e:
        raise Exception(f"音声ファイルの読み込みに失敗しました: {e}")


def calculate_rms_dbfs(audio, sr, window_size=0.1):
    """
    Calculate RMS energy in dBFS for windows

    Args:
        audio: Audio waveform (numpy array)
        sr: Sample rate
        window_size: Window size in seconds (default 0.1s = 100ms)

    Returns:
        numpy array of dBFS values for each window
    """
    # Calculate window size in samples
    hop_length = int(window_size * sr)

    # Calculate RMS for each window
    rms_values = []
    for i in range(0, len(audio), hop_length):
        window = audio[i : i + hop_length]
        if len(window) > 0:
            rms = np.sqrt(np.mean(window**2))
            # Convert to dBFS (reference: 1.0 = 0 dBFS)
            if rms > 0:
                dbfs = 20 * np.log10(rms)
            else:
                dbfs = -100  # Very quiet
            rms_values.append(dbfs)

    return np.array(rms_values)


def detect_voice_activity(dbfs_values, threshold):
    """
    Detect voice activity based on dBFS threshold

    Args:
        dbfs_values: Array of dBFS values
        threshold: dBFS threshold (e.g., -38.0)

    Returns:
        Boolean array (True = voice active, False = silence)
    """
    return dbfs_values > threshold


def assign_cameras(activity1, activity2):
    """
    Assign camera angles based on speaker activity

    Camera assignment logic:
    - Speaker 1 only → camera 1
    - Speaker 2 only → camera 2
    - Both speaking → camera 3 (wide shot)
    - Neither speaking → maintain previous camera

    Args:
        activity1: Boolean array for speaker 1 activity
        activity2: Boolean array for speaker 2 activity

    Returns:
        Array of camera numbers (1, 2, or 3)
    """
    cameras = []
    current_camera = 1  # Start with camera 1

    for a1, a2 in zip(activity1, activity2):
        if a1 and a2:
            # Both speaking - wide shot
            current_camera = 3
        elif a1:
            # Only speaker 1
            current_camera = 1
        elif a2:
            # Only speaker 2
            current_camera = 2
        # else: neither speaking - keep current camera

        cameras.append(current_camera)

    return np.array(cameras)


def create_cut_segments(cameras, window_size, min_duration):
    """
    Create cut segments from camera assignments, merging short segments

    Args:
        cameras: Array of camera numbers
        window_size: Size of each window in seconds
        min_duration: Minimum cut duration in seconds

    Returns:
        List of cut dictionaries with startTime, endTime, camera
    """
    if len(cameras) == 0:
        return []

    segments = []
    current_camera = cameras[0]
    start_time = 0.0

    # Create initial segments
    for i, camera in enumerate(cameras):
        if camera != current_camera:
            # Camera changed - create segment
            end_time = i * window_size
            segments.append({"startTime": start_time, "endTime": end_time, "camera": int(current_camera)})
            start_time = end_time
            current_camera = camera

    # Add final segment
    end_time = len(cameras) * window_size
    segments.append({"startTime": start_time, "endTime": end_time, "camera": int(current_camera)})

    # Merge segments shorter than min_duration
    merged = []
    i = 0
    while i < len(segments):
        segment = segments[i]
        duration = segment["endTime"] - segment["startTime"]

        if duration < min_duration and len(merged) > 0:
            # Merge with previous segment
            merged[-1]["endTime"] = segment["endTime"]
            # Keep previous camera
        else:
            merged.append(segment)

        i += 1

    return merged


def analyze_audio_files(speaker1_path, speaker2_path, threshold, min_duration, output_path):
    """
    Main analysis function

    Args:
        speaker1_path: Path to speaker 1 WAV file
        speaker2_path: Path to speaker 2 WAV file
        threshold: dBFS threshold for voice detection
        min_duration: Minimum cut duration in seconds
        output_path: Path to output JSON file

    Returns:
        Dictionary with cut list
    """
    emit_progress(0.0, "音声ファイルを読み込んでいます...")

    # Validate file sizes before loading
    try:
        validate_file_size(speaker1_path)
        validate_file_size(speaker2_path)
    except Exception as e:
        emit_progress(0.0, f"エラー: {e}")
        raise

    # Load audio files
    try:
        audio1, sr1 = load_audio(speaker1_path)
        emit_progress(0.1, f"話者1を読み込みました ({len(audio1) / sr1:.1f}秒)")

        audio2, sr2 = load_audio(speaker2_path)
        emit_progress(0.2, f"話者2を読み込みました ({len(audio2) / sr2:.1f}秒)")

    except Exception as e:
        emit_progress(0.0, f"エラー: {e}")
        raise

    # Validate sample rates match
    if sr1 != sr2:
        raise Exception(f"サンプルレートが一致しません: {sr1} Hz vs {sr2} Hz")

    sr = sr1

    # Calculate RMS energy in dBFS
    emit_progress(0.3, "音声エネルギーを解析しています...")
    window_size = 0.1  # 100ms windows

    dbfs1 = calculate_rms_dbfs(audio1, sr, window_size)
    emit_progress(0.4, f"話者1の解析完了 ({len(dbfs1)} ウィンドウ)")

    dbfs2 = calculate_rms_dbfs(audio2, sr, window_size)
    emit_progress(0.5, f"話者2の解析完了 ({len(dbfs2)} ウィンドウ)")

    # Ensure both arrays are same length (pad shorter one)
    max_len = max(len(dbfs1), len(dbfs2))
    if len(dbfs1) < max_len:
        dbfs1 = np.pad(dbfs1, (0, max_len - len(dbfs1)), constant_values=-100)
    if len(dbfs2) < max_len:
        dbfs2 = np.pad(dbfs2, (0, max_len - len(dbfs2)), constant_values=-100)

    # Detect voice activity
    emit_progress(0.6, "音声区間を検出しています...")
    activity1 = detect_voice_activity(dbfs1, threshold)
    activity2 = detect_voice_activity(dbfs2, threshold)

    # Assign cameras
    emit_progress(0.7, "カメラ割り当てを計算しています...")
    cameras = assign_cameras(activity1, activity2)

    # Create cut segments
    emit_progress(0.8, "カット区間を作成しています...")
    cuts = create_cut_segments(cameras, window_size, min_duration)

    # Create output data
    output_data = {"version": "1.0", "cuts": cuts}

    # Write output file
    emit_progress(0.9, "結果を保存しています...")
    try:
        output_file = Path(output_path)
        output_file.parent.mkdir(parents=True, exist_ok=True)

        with output_file.open("w", encoding="utf-8") as f:
            json.dump(output_data, f, ensure_ascii=False, indent=2)

        emit_progress(1.0, f"完了: {len(cuts)} カット生成")

    except Exception as e:
        raise Exception(f"出力ファイルの書き込みに失敗しました: {e}")

    return output_data


def main():
    """Command-line entry point"""
    parser = argparse.ArgumentParser(
        description="Multicam auto-cut audio analyzer", formatter_class=argparse.RawDescriptionHelpFormatter
    )

    parser.add_argument("--speaker1", required=True, help="Path to speaker 1 WAV file")

    parser.add_argument("--speaker2", required=True, help="Path to speaker 2 WAV file")

    parser.add_argument(
        "--threshold", type=float, default=-38.0, help="Voice detection threshold in dBFS (default: -38.0)"
    )

    parser.add_argument(
        "--min-duration", type=float, default=1.0, help="Minimum cut duration in seconds (default: 1.0)"
    )

    parser.add_argument("--output", required=True, help="Path to output JSON file")

    args = parser.parse_args()

    # Validate input files exist
    speaker1_path = Path(args.speaker1)
    if not speaker1_path.exists():
        print(f"エラー: ファイルが見つかりません: {args.speaker1}", file=sys.stderr)
        sys.exit(1)

    speaker2_path = Path(args.speaker2)
    if not speaker2_path.exists():
        print(f"エラー: ファイルが見つかりません: {args.speaker2}", file=sys.stderr)
        sys.exit(1)

    # Run analysis
    try:
        analyze_audio_files(str(speaker1_path), str(speaker2_path), args.threshold, args.min_duration, args.output)
        sys.exit(0)

    except Exception as e:
        print(f"エラー: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
