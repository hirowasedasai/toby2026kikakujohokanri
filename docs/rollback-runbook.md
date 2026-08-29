# ロールバック手順

bound scriptはHEADのコードを実行し、`clasp version`だけでは実行コードが切り替わらない。Gitを正本として、既知の正常なcommitを新しい復旧commitとしてmainへ戻し、通常のproductionリリース手順で`clasp push`する。`clasp deploy`は使わない。

1. 影響が継続する場合は`uninstallTriggers`で管理対象triggerを止める。production確認を行う。
2. `26処理ログ`の実行ID、RELEASE_ID、エラーコード、発生時刻を記録する。個人情報や入力原文は転記しない。
3. Git履歴とリリース時に作ったApps Script versionの説明から、直前の正常Git SHAを特定する。
4. main上で対象変更を`git revert`するPRを作る。履歴を書き換えずレビューする。
5. `npm ci`、`npm run verify`、staging確認を実施する。
6. 明示承認後、productionリリース手順でpushし、新しい復旧versionを作る。
7. 事前チェックとdry run後に参参一覧を差分同期し、屋台情報まとめを更新し、局別タブを差分同期する。参参一覧の申込情報3列、局別タブの手動6列、入力4タブは変更しない。
8. 原因解消と権限確認後、必要なtriggerだけを再インストールする。

Spreadsheetのマスター自体を戻す必要がある場合は、Google Sheetsの版履歴を使う前に対象時刻と影響行を二名で確認する。全シートの一括復元は入力生データや正常な後続変更を巻き戻すため、最後の手段とする。
