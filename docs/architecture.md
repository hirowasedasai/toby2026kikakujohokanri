# アーキテクチャ

## 境界

システムはGoogle Sheetsとcontainer-bound Apps Scriptだけで構成する。外部DB、Cloud Run、FastAPI、OpenAI API、外部秘密管理、外部URLアクセス、Webアプリ公開は使わない。Apps Script本体にnpm runtime依存はなく、npmはローカル検証と`clasp`操作だけに使う。

stagingとproductionは、スプレッドシートもApps Script projectも完全に別である。各scriptはScript Propertiesの`EXPECTED_SPREADSHEET_ID`と実際のバウンド先IDを毎回照合する。`APP_ENV`が`staging`または`production`以外でも停止する。

## データフロー

```text
入力4タブ（read-only）
        │ ヘッダー解決・行検証・キー判定
        ▼
26掲載情報マスター（唯一の正本）
        │ メモリ上で出力全体を構築・検証
        ├──────────► 参参一覧
        └──────────► 屋台情報まとめ

各処理 ──サニタイズ済み要約──► 26処理ログ
```

同期は`LockService.getScriptLock()`で直列化する。全タブと必須ヘッダー、環境一致を開始前に確認し、致命的な不整合時にはマスターと出力を変更しない。入力は常に`getValues()`で一括取得し、マスターと出力もメモリ上で完成させてから`setValues()`で一括反映する。古い出力は新しい値を書いた後に余剰行だけを消す。

Apps Script/Sheetsには複数シートをまとめたACID transactionがない。このため`runAll`は同一lock内で同期、参参一覧、屋台情報まとめの順に処理し、各段階をログに残す。途中失敗時は正常だった直前状態を保持し、入力や既存出力を先に全消去しない。

## キーと競合

正式企画IDがある行は正規化済み正式IDをキーにする。ない行だけ、NFKC Unicode正規化・trim・メール小文字化後の`メールアドレス + 参加企画`を暫定キーにする。暫定管理IDは予約prefix`TMP-`と決定的hashから生成するため、再実行しても同じIDになる。

既存行を更新しても`管理ID`は変更しない。暫定キー衝突やキー変更疑いは自動統合せず、`要確認`と理由を付けてログに残す。既存マスター自体にキーまたは管理IDの重複があれば開始前エラーとして停止する。

## セキュリティと監査

manifest scopeは現在のスプレッドシート操作とtrigger管理だけに限定する。ログは入力行全体、メールアドレス、自由記述本文を保存せず、実行ID、環境、処理名、行番号、列名、エラーコード、制御された短い説明、件数、リリースIDだけを記録する。説明に混入したメールとURLは置換する。

productionではテストデータ投入、全消去、危険な初期化を行う関数を提供しない。スキーマ作成は通常同期から分離した`setupProductionSchema`だけで、環境照合と`PRODUCTION`入力確認を必須とする。
