# インシデント対応

## 直ちに止める

1. production権限者が`uninstallTriggers`を実行し、確認ダイアログを承認する。
2. 手動の同期・全処理を停止する。`ENABLE_SCHEDULED_SYNC=false`にも変更するが、既存時間triggerは`uninstallTriggers`で削除する。
3. 入力、マスター、出力を消去・並べ替え・復元しない。

## 証跡を保全する

`26処理ログ`から実行ID、日時、環境、RELEASE_ID、処理名、エラーコード、行番号、列名、件数だけを記録する。メール、自由記述、入力行全体、実ID、tokenはissueやチャットに貼らない。Apps Script Executionsでは時刻と失敗関数をread-onlyで確認する。

## エラーコード別の初動

| コード | 初動 |
| --- | --- |
| `E_SPREADSHEET_MISMATCH` | Script Propertiesとバウンド先の組み合わせを権限者が確認。値は共有しない |
| `E_SHEET_MISSING` | タブ名変更や削除を確認。スクリプトから入力タブを作らない |
| `E_INPUT_HEADER_MISSING` | 入力1行目の表記を確認。データ行を変更しない |
| `E_MASTER_HEADER_MISSING` | マスタースキーマ変更履歴を確認。通常同期で自動修復しない |
| `E_MASTER_DUPLICATE_KEY` | 該当行を権限者二名で確認し、自動統合しない |
| `E_MASTER_DUPLICATE_ID` | 管理IDの重複行を権限者二名で確認し、通常同期で自動修復しない |
| `E_PROVISIONAL_KEY_COLLISION` | 要確認行とフォーム原本を権限者だけで照合する |
| `E_OUTPUT_EMPTY_GUARD` | マスターの同期状態・要確認件数を確認。既存出力は維持される |
| `E_CHANGE_PROJECT_NOT_FOUND` / `E_CHANGE_PROJECT_AMBIGUOUS` | `26要手動確認`で企画名と通常回答の重複・表記を確認。曖昧一致で上書きしない |
| `E_CHANGE_FORMAT_INVALID` / `E_CHANGE_FIELDS_MISMATCH` | 変更前後が`項目名：「内容」`形式で、同じ項目集合かを回答原本で確認する |
| `E_CHANGE_BEFORE_MISMATCH` | 通常回答の現在値と変更前を照合し、先行変更や転記差異を人力確認する |
| `E_CHANGE_BUREAU_MISMATCH` / `E_CHANGE_DEPARTMENT_MISMATCH` | 所属局・部署名を回答原本で確認し、自動上書きしない |
| `E_CHANGE_IMAGE_REVIEW_REQUIRED` | 画像変更を`26要手動確認`で人力確認する |
| `E_LOCK_TIMEOUT` | 重複実行や長時間実行を確認し、時間を置く |

## 復旧

コード起因はロールバック手順、データ・スキーマ起因はstagingで合成再現して修正する。`npm run verify`、staging dry run、レビュー、明示承認を経てproductionへ反映する。復旧後に必要なtriggerだけを再作成し、事後記録にはPIIを含めない。
