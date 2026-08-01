# Repository rules

- Gitリポジトリをソースコードの唯一の正本とする。
- Apps Script editorでコードを手編集しない。変更はGitでレビューし、`clasp`で同期する。
- `26参参フォーム回答`、`提出遅延フォーム回答`、`変更申請`には一切書き込まない。
- 個人情報、実データ、Spreadsheet ID、Script ID、OAuthトークン、APIキー、認証情報をcommitしない。
- productionへのpush/deployは、ユーザーからその操作を明示依頼された場合だけ行う。
- production変更前に`npm run verify`、clean worktree、`main` branchを確認する。
- 列位置は必ず1行目のヘッダー名から解決し、列番号を固定しない。
- 行単位のエラーがあっても処理可能な行を継続し、PIIを含めず処理ログへ記録する。
- 動作、運用、列マッピング、権限、安全条件を変えた場合は関連する`docs/`も同時に更新する。
- Apps Script本体に外部runtime依存を追加しない。
- `.clasp*.json`と`.clasprc.json`はGitへ追加しない。
