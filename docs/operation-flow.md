# 運用フロー

## 初回構築

1. 管理者がstaging用とproduction用に別々のGoogle Spreadsheetを用意し、それぞれにcontainer-bound Apps Script projectを作る。
2. 各Spreadsheetに入力4タブを正しいフォーム連携で用意する。スクリプトからは作成しない。
3. 各projectのScript Propertiesへ`APP_ENV`、`EXPECTED_SPREADSHEET_ID`、`RELEASE_ID`、`ENABLE_SCHEDULED_SYNC`を設定する。
4. ローカルにignore済みの`.clasp.staging.json`と`.clasp.production.json`を用意する。
5. `npm install`と`npm run verify`を実行する。
6. 明示承認された環境へ`clasp`で同期する。コードをApps Script editorへ貼り付けない。
7. stagingでは`setupStagingSchema`を実行する。productionでは初回だけ`setupProductionSchema`を選択し、確認文字列を入力する。
8. `事前チェック`、dry run、通常同期、参参一覧・屋台情報まとめ・局別タブの順に確認する。

## 日常運用

1. `当日情報媒体AI > 事前チェック`で環境、タブ、ヘッダーを検証する。
2. `ドライラン: フォーム回答を同期`で件数と要確認を確認する。dry runは入力・マスター・出力を変えず、ログだけを追記する。
3. `フォーム回答を同期`を実行し、`26処理ログ`の同じ実行IDを確認する。
4. `局別タブを更新`で運スタ通常回答へ一意・完全一致した変更申請を適用し、所属局別に再生成する。回答原本とマスターは書き換えない。
5. Spreadsheetを開いたときに未対応toastが出た場合、`当日情報媒体AI > 要手動確認を開く`から`26要手動確認`を確認する。人力対応が完了した行だけ`対応状況=対応済み`とする。
6. 参参変更申請と、要手動確認になった運スタ変更申請を権限者が確認する。自動で曖昧一致や部分反映をしない。
7. マスターの要確認行を権限者が解決する。自動統合はしない。
8. `参参一覧を更新`、`屋台情報まとめを更新`、`局別タブを更新`、または`全処理を実行`を使う。

行エラーは正常行を止めない。タブ欠落、環境不一致、必須ヘッダー欠落、マスターキー重複は全体を止める。エラー調査では行番号と列名を使い、処理ログへ原文を転記しない。

## 自動実行

初期状態でinstallable triggerはない。必要な場合だけ`installTriggers`を関数として実行する。フォーム送信時triggerは通常提出2タブをマスターへ同期し、運スタ通常回答では続けて局別タブも更新する。運スタ変更申請では局別タブと要手動確認だけを更新し、マスター同期は起動しない。参参変更申請もマスター同期を起動しない。時間主導同期は`ENABLE_SCHEDULED_SYNC=true`の場合だけ1時間ごとに作り、マスター同期後に局別タブと要手動確認も更新する。重複triggerは作らない。

triggerはインストールした作成者アカウントの権限で実行される。退任・異動前に後任が権限とtriggerを引き継ぐ。productionでのinstall/uninstallは確認ダイアログを必須とする。

## 緊急時のread-only確認

Apps Script editorではコードを変更しない。Execution log、projectのtrigger一覧、Script Propertiesのキーの有無、Spreadsheetのタブ名・1行目ヘッダーだけを確認してよい。実IDや個人情報をissue、チャット、commitへ貼らない。
