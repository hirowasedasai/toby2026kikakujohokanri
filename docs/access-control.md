# アクセス制御

最小権限と職務分離を原則とする。

| ロール | Spreadsheet | Apps Script project | Git/リリース |
| --- | --- | --- | --- |
| フォーム回答者 | Form送信のみ | なし | なし |
| 閲覧担当 | 必要な出力の閲覧のみ | なし | なし |
| データ運用担当 | staging編集、productionは必要範囲 | 実行のみ | PR閲覧 |
| リリース担当 | staging/production編集 | editor・trigger管理 | PR mergeと明示承認後のpush |
| 監査担当 | ログread-only | Executions read-only | 履歴read-only |

入力4タブにはフォーム連携以外の書き込みを行わない。マスター編集権限、処理ログ閲覧権限、Script Properties・trigger変更権限は少人数に限定する。メールを含むマスターとPIIを含まない公開用出力で共有範囲を分ける。局別タブと`26要手動確認`はメールを含まないが、担当者名、自由記述、添付リンクを含むため、該当する局と運用担当者に閲覧範囲を限定する。要手動確認の`対応状況`は権限者だけが変更する。

installable triggerは作成者アカウントの認可で動く。個人アカウントへの恒久依存を避け、組織管理アカウントで作成者、後任、定期棚卸し日を記録する。退任時は後任がtriggerを再作成し、旧作成者のtriggerを削除する。

ローカルの`.clasp.staging.json`、`.clasp.production.json`、`.clasp.json`、`.clasprc.json`は各担当者だけが読めるようにし、Git、CI artifact、画面共有、issue、チャットへ出さない。Script IDとSpreadsheet IDの実値は文書へ記載しない。

四半期ごと、担当交代時、インシデント後に次を棚卸しする。

- SpreadsheetとApps Scriptのeditor/viewer
- Form連携先と入力タブ名
- Script Propertiesのキーの有無（値そのものは記録しない）
- installable triggerのhandler、作成者、頻度、重複
- GitHub branch protectionとproduction実行権限
