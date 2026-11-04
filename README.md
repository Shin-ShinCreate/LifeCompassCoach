# Life Compass Coach（MVP）

目標を「北極星」に、朝と夜のルーティンで星を集めるセルフケアPWA。
仕様書：Obsidian `04_AI・情報発信/潜在意識/Life Compass Coach 仕様書.md`

## 構成（ビルド不要）

| ファイル | 役割 |
|---|---|
| `index.html` / `styles.css` | 画面の土台と見た目（夜空テーマ） |
| `app.js` | 本体：画面切り替え、ルーティン、星座、記録、録音、バックアップ |
| `audio.js` | BGMの自動生成（宇宙・波・雨）、ベル、音声再生 |
| `data.js` | アファメーション文例・ガイド台本・星座名・注意書き |
| `audio/` | VOICEVOX（青山龍星）で作った音声と `manifest.json`（一覧） |
| `sw.js` / `manifest.webmanifest` / `icons/` | PWA（オフライン対応・ホーム画面追加） |
| `tools/generate_audio.py` | 音声の一括生成 |
| `tools/make_icons.py` | PNGアイコン生成 |

データは端末内に保存（設定・記録は localStorage、録音は IndexedDB）。

## 手元で動かす

```bash
cd ~/アプリ/LifeCompassCoach
python -m http.server 8765 --bind 127.0.0.1
```
ブラウザで http://127.0.0.1:8765/ を開く。

## 音声を作り直す（VOICEVOX または AivisSpeech を起動しておく）

```bash
python tools/generate_audio.py --list        # 声の一覧とID
python tools/generate_audio.py --samples     # samples/ に聞き比べ用を作成
# 現在の声（VOICEVOX:青山龍星 ノーマル／話速0.85・高さ-0.03・抑揚0.9）
python tools/generate_audio.py --engine voicevox --speaker 13 --voice-name "青山龍星" --speed 0.85 --pitch -0.03 --intonation 0.9
# AivisSpeech の声で作る場合
python tools/generate_audio.py --speaker 888753763 --voice-name "まお（おちつき）"
```
`data.js` の文例やガイド台本を書き換えたときも、このコマンドで作り直す。
VOICEVOX の声は「VOICEVOX:キャラ名」のクレジット表記が必須（設定画面に自動表示）。

## フリー素材BGMを足す

`audio/bgm/` に mp3 を置き、`audio/manifest.json` の `bgm` に追加すると設定画面の選択肢に出る。

```json
"bgm": [{ "id": "forest", "name": "森の朝", "file": "audio/bgm/forest.mp3", "credit": "BGM：○○（サイト名）" }]
```

## 表現のルール

- 「治る」「必ず叶う」など効果を断定する表現は使わない（薬機法・AivisSpeech の ACML 禁止事項）
- 注意書きは `data.js` の `DISCLAIMER`

## 未対応（後回し）

通知リマインダー、AIによる文例提案、クラウド同期、有料機能、ストア版
