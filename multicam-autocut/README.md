# Multicam Auto-Cut for Premiere Pro

話者別音声解析に基づく自動マルチカメラカット割りCEP拡張機能

## 概要

この Premiere Pro 拡張機能は、2名の話者の音声トラックを解析し、どちらが話しているかに基づいて自動的にマルチカメラのカメラアングルを切り替えます。

### 機能

- **音声解析**: librosa を使用した RMS エネルギーベースの音声検出
- **自動カメラ割り当て**:
  - 話者1のみ → カメラ1
  - 話者2のみ → カメラ2
  - 両者が話している → カメラ3 (ワイドショット)
  - どちらも話していない → 前のカメラを維持
- **カット最適化**: 設定した最小長以下の短いカットを自動的にマージ
- **リアルタイム進捗表示**: 解析とカット適用の進捗をパネル上で確認

## 必要環境

### システム要件

- **Premiere Pro**: バージョン 22.0 以降
- **OS**: macOS または Windows
- **Python**: 3.7 以降
- **Node.js**: CEP が有効な環境

### Python 依存パッケージ

```bash
pip install librosa numpy
```

## インストール

### 1. 拡張機能フォルダへコピー

#### macOS
```bash
cp -r multicam-autocut ~/Library/Application\ Support/Adobe/CEP/extensions/
```

#### Windows
```bash
xcopy /E /I multicam-autocut %APPDATA%\Adobe\CEP\extensions\multicam-autocut
```

### 2. デバッグモードを有効化 (開発時のみ)

CEP 拡張機能を読み込むには、Premiere Pro でデバッグモードを有効にする必要があります。

#### macOS
```bash
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
```

#### Windows (レジストリエディタで設定)
```
HKEY_CURRENT_USER\Software\Adobe\CSXS.11
キー名: PlayerDebugMode
タイプ: String
値: 1
```

### 3. Premiere Pro を再起動

拡張機能を読み込むため、Premiere Pro を再起動してください。

## 使い方

### 1. パネルを開く

Premiere Pro のメニューから:
**ウィンドウ** → **エクステンション** → **話者別 自動カット割**

### 2. 音声ファイルを選択

- **話者1 / V1 トラック**: 最初の話者の音声 WAV ファイルを選択
- **話者2 / V2 トラック**: 2番目の話者の音声 WAV ファイルを選択

### 3. パラメータを調整

- **音声検出しきい値**: -50 dBFS 〜 -20 dBFS (デフォルト: -38 dBFS)
  - 値を上げる = より大きい音のみ検出 (背景ノイズを除外)
  - 値を下げる = より小さい音も検出 (小声も拾う)

- **最小カット長**: 0.5秒 〜 3.0秒 (デフォルト: 1.0秒)
  - この長さより短いカット区間は前のカットにマージされます
  - 長くすると頻繁な切り替えを防止

### 4. シーケンスを準備

- マルチカメラシーケンスを開き、アクティブにします
- V1 トラックにマルチカメラクリップが配置されていることを確認

### 5. 実行

**▶ 自動カット割を実行** ボタンをクリック

### 6. 進捗を確認

- 進捗バーで解析とカット適用の状況を確認
- ログエリアに詳細な処理状況が表示されます

## アーキテクチャ

この拡張機能は3つの主要コンポーネントで構成されています:

### 1. CEP Panel (HTML/JavaScript)
- **場所**: `index.html`, `js/main.js`
- **役割**: ユーザーインターフェースと全体のオーケストレーション
- **技術**: HTML5, JavaScript, CSInterface

### 2. Python Analyzer
- **場所**: `python/analyze.py`
- **役割**: 音声解析とカットリスト生成
- **技術**: librosa, numpy
- **処理フロー**:
  1. WAV ファイル読み込み
  2. RMS エネルギー計算 (100ms ウィンドウ)
  3. dBFS 変換
  4. しきい値ベースの音声検出
  5. カメラ割り当てロジック
  6. 短区間のマージ
  7. JSON 出力

### 3. ExtendScript Automation
- **場所**: `jsx/autocut.jsx`
- **役割**: Premiere Pro への自動カット適用
- **技術**: ExtendScript, QE DOM
- **処理フロー**:
  1. JSON カットリスト読み込み
  2. アクティブシーケンス取得
  3. QE DOM で razor カット適用
  4. マルチカメラアングル設定
  5. 結果レポート

## ディレクトリ構造

```
multicam-autocut/
├── CSXS/
│   └── manifest.xml          # CEP 拡張機能マニフェスト
├── index.html                # UI パネル
├── js/
│   └── main.js               # CEP オーケストレーション
├── jsx/
│   └── autocut.jsx           # ExtendScript 自動化
├── python/
│   └── analyze.py            # 音声解析スクリプト
└── README.md                 # このファイル
```

## トラブルシューティング

### 拡張機能が表示されない

1. CEP フォルダに正しくコピーされているか確認
2. デバッグモードが有効になっているか確認
3. Premiere Pro を再起動
4. CEP のバージョンが合っているか確認 (manifest.xml)

### Python エラー

```
エラー: Python が見つかりません
```
→ Python 3.7+ がインストールされ、PATH に含まれているか確認

```
エラー: librosa が見つかりません
```
→ `pip install librosa numpy` を実行

### カット適用エラー

```
エラー: アクティブなシーケンスがありません
```
→ マルチカメラシーケンスを開いてアクティブにしてください

```
Warning: Failed to set camera angle
```
→ クリップがマルチカメラクリップではない、またはカメラアングルが存在しない可能性があります

## 開発者向け情報

### デバッグ

Chrome DevTools でパネルをデバッグ:
1. Premiere Pro でパネルを開く
2. ブラウザで `http://localhost:8088` にアクセス
3. パネルを選択してデバッグコンソールを開く

### ExtendScript のテスト

CEP コンソールから:
```javascript
csInterface.evalScript('testExtendScript()', (result) => {
    console.log(JSON.parse(result));
});
```

### Python スクリプトの単体テスト

コマンドラインから直接実行:
```bash
python analyze.py \
    --speaker1 /path/to/speaker1.wav \
    --speaker2 /path/to/speaker2.wav \
    --threshold -38 \
    --min-duration 1.0 \
    --output /tmp/cuts.json
```

## 技術仕様

### 時間単位変換

Premiere Pro のタイムコード単位 (ticks):
- 1秒 = 254016000000 ticks
- 変換式: `ticks = Math.round(seconds * 254016000000)`

### 音声解析パラメータ

- **ウィンドウサイズ**: 100ms (0.1秒)
- **RMS エネルギー**: 各ウィンドウの二乗平均平方根
- **dBFS 変換**: `20 * log10(rms)` (基準: 1.0 = 0 dBFS)

### カメラ割り当てロジック

```
Speaker1  Speaker2  → Camera
-----------------------------
   ON        ON     →    3    (両方)
   ON       OFF     →    1    (話者1)
  OFF        ON     →    2    (話者2)
  OFF       OFF     → (前維持) (どちらも話していない)
```

## ライセンス

Copyright 2025 Henkaku. All rights reserved.

## サポート

問題や質問がある場合は、開発チームにお問い合わせください。
