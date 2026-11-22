# GraceInterpret — 教会礼拝・説教 リアルタイム同時通訳アプリ

日本のプロテスタント教会における主日礼拝・説教・祈祷・報告を、**登録した教会用語集（辞書）に沿ってリアルタイムに日本語から英語へ同時通訳し、画面やプロジェクターに大きく表示するWebアプリ**です。

## 主な特徴

1. **プロテスタント教会用語プリセット搭載（約55語＋自由追加・編集）**
   - **礼拝・式次第**: 主日礼拝 (`Sunday Worship Service`)、招詞 (`Call to Worship`)、交読文 (`Responsive Reading`)、頌栄 (`Doxology`)、祝祷 (`Benediction`)、聖餐式 (`Holy Communion`) など
   - **神学・教理**: 福音 (`the Gospel`)、恵み (`grace`)、贖い (`redemption`)、義とされる (`justified by faith`)、聖化 (`sanctification`)、聖霊 (`the Holy Spirit`) など
   - **教職・組織**: 牧師 (`Pastor`)、長老 (`Elder`)、執事 (`Deacon`)、求道者 (`seeker`)、教会学校 (`Sunday School`) など
   - **祈り・信仰生活**: 証し (`testimony`)、とりなしの祈り (`intercessory prayer`)、交わり (`fellowship`)、主イエス・キリストの御名によって祈ります (`In the name of our Lord Jesus Christ we pray`) など
2. **音声認識の同音異義語・誤変換自動補正**
   - マイク音声認識で誤変換されやすい教会用語（例：「生産式」→「聖餐式」、「照明」→「召命」、「福井」→「福音」など）を通訳前に自動補正します。各用語ごとに独自の誤変換ワードも登録可能です。
3. **1台のPC・タブレットで完結する3つの表示モード＋プロジェクター全画面**
   - **操作＆用語集 2画面（標準）**: 用語集を確認・編集しながら通訳をモニタリング
   - **日英字幕 大きく表示**: 英語字幕と日本語原文を上下に大きく表示
   - **英語字幕のみ特大（投影用）**: プロジェクターや大型モニターへの投影に最適（`Alt + P` または「⛶ プロジェクター表示」ボタンで全画面黒背景の字幕専用モードへ切替）
4. **Gemini API (`@google/genai` SDK) 搭載 ＋ APIキー不要のデモモード**
   - 最新モデル `gemini-3.8-flash` / `gemini-3.5-flash-lite`（Interactions API ストリーミング）および `gemini-3.8-live`（Gemini Live API 直接音声ストリーム）に対応。
   - APIキー設定前でも「礼拝サンプル文でテスト通訳」から教会用語ハイライト付きのリアルタイム通訳動作を確認できます。

## 起動方法（いつでも簡単に開く手順）

### 方法1：ダブルクリックで起動（一番簡単）
デスクトップの `TranslationApp` フォルダの中にある **`アプリを起動する.command`** をダブルクリックしてください。
自動的にローカルサーバーが立ち上がり、ブラウザで `http://localhost:8080` が開きます。

### 方法2：ターミナルから起動する場合
ターミナルで以下のコマンドを実行し、ブラウザ（Google Chrome 推奨）で `http://localhost:8080` を開いてください。

```bash
cd /Users/kouichimatsumoto/Desktop/TranslationApp
python3 -m http.server 8080
```
