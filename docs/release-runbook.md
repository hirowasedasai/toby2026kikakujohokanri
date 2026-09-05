# リリース手順

## staging

1. 変更をレビューし、動作変更に対応するdocsと合成テストがあることを確認する。
2. `npm ci`、`npm run verify`を実行する。
3. ignore済み`.clasp.staging.json`がstaging projectを指すことをローカルで確認する。値を画面共有やログへ出さない。
4. ユーザーからGoogleへの反映を明示依頼された場合だけ`npm run deploy:staging`を実行する。
5. staging Spreadsheetで環境情報、事前チェック、dry run、同期、出力、PIIなしログを確認する。

スクリプトはverify後にstaging設定を`.clasp.json`へ安全に選択し、`clasp push`し、Git SHAを説明に含むApps Script versionを作る。deploymentは作らない。

## production

1. staging確認結果をPRへ記録してmainへmergeする。
2. `main` branchかつclean worktreeであることを確認する。
3. `npm run verify`を再実行する。
4. productionの`RELEASE_ID`を反映対象Git SHAへ更新する。
5. ユーザーからproduction反映を明示依頼された場合だけ`npm run deploy:production`を実行する。
6. 画面に出る`production`とScript IDの部分表示を確認し、意図した場合だけ`PRODUCTION`と入力する。
7. production Spreadsheetを再読み込みし、自動同期triggerが動く前に`当日情報媒体AI > 出力スキーマを更新`で確認文字列`PRODUCTION`を入力する。`参参一覧`へ非表示の`回答識別子`列、非表示の`26参参除外管理`タブ、重複警告の条件付き書式が追加されることを確認する。入力5タブは変更しない。
8. 環境情報、事前チェック、dry runを実行し、件数確認後に同期する。参参一覧で全フォーム回答が保持され、人が付けた`キャンセル`・`確認中`が保持されることを確認する。合成データを使えるstagingでは、同一メアド・参参名・参加企画の全行だけが警告され、参加企画が違う回答は警告されないこと、誤回答の選択除外後に誤回答が復活せず残りの警告が解除されることも確認する。productionへ検証用回答を追加しない。
9. 出力と`26処理ログ`を確認する。自動同期を使う場合だけ`当日情報媒体AI > 自動同期を有効化`を実行し、フォーム送信triggerを重複なしで作成する。

productionスクリプトは`main`、clean worktree、verifyを強制し、`--force`を使わない。通常のbound scriptのため`clasp deploy`は使わず、追跡用versionだけを作る。

push前にGitに存在しない本番ファイルがないか検査する。manifestの変更確認は端末で内容を確認して回答する。push後にリモートの全ファイルとローカルコードを比較し、一致した場合だけversionを作成する。`Skipping push.`や内容不一致をdeploy成功と扱わない。画像処理の環境別フォルダIDは[画像処理の管理](image-processing.md)に従ってScript Propertiesへ移す。画像処理そのものはdeploy検証で実行しない。

## 禁止事項

- Apps Script editorでのコード手編集
- 実ID、token、`.clasprc.json`のcommitやログ出力
- 未確認の`--force` push
- CIからのGoogle認証、push、deploy
- staging projectをproduction Spreadsheetへバウンドするなどの環境共用
