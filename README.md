# 早稲田祭2026「当日情報媒体」企画情報管理

Googleフォーム回答を読み取り専用の生データとして保ち、`26掲載情報マスター`を掲載情報の唯一の正本にするcontainer-bound Google Apps Scriptです。マスターから`参参一覧`と`屋台情報まとめ`を再生成し、処理の要約とサニタイズ済みエラーを`26処理ログ`へ残します。

Gitリポジトリがコードの正本です。Apps Script editorでコードを手編集せず、stagingで確認後に`clasp`でproductionへ反映します。このリポジトリに実データ、個人情報、Spreadsheet ID、Script ID、OAuthトークン、APIキーを保存しないでください。

## 構成

- `apps-script/`: 外部runtime依存のないApps Script本体
- `scripts/`: 環境選択、検証、staging/production反映スクリプト
- `config/`: 偽のplaceholderだけを含むclasp設定例
- `test/`: `.example`ドメインだけを使う合成fixtureと純粋ロジックのテスト
- `docs/`: 設計、列対応、運用、リリース、ロールバック、インシデント、権限
- `.github/`: PRテンプレートとGoogleへ接続しないCI

シートの役割は次のとおりです。

| 種別 | シート |
| --- | --- |
| 読み取り専用入力 | `26参参フォーム回答`、`26運スタ企画フォーム回答`、`26参参変更申請`、`26運スタ企画変更申請` |
| 唯一の正本 | `26掲載情報マスター` |
| 再生成出力 | `参参一覧`、`屋台情報まとめ` |
| 監査 | `26処理ログ` |

詳細は[アーキテクチャ](docs/architecture.md)、[シート構成](docs/sheet-structure.md)、[列マッピング](docs/column-mapping.md)を参照してください。

## ローカル品質チェック

Node.js 20を基準にします。Google認証は不要です。

```sh
npm install
npm run lint
npm test
npm run verify
```

CIはpull requestで`npm ci`と`npm run verify`だけを実行し、Googleへのpush/deployは行いません。

## 環境分離と初期設定

stagingとproductionには、それぞれ別のスプレッドシートと別のcontainer-bound Apps Script projectを用意します。Google側の作業者は各プロジェクトのScript Propertiesに以下を設定します。

| Property | 値 |
| --- | --- |
| `APP_ENV` | `staging`または`production` |
| `EXPECTED_SPREADSHEET_ID` | そのscriptがバウンドされたスプレッドシートのID |
| `RELEASE_ID` | Git SHAやリリース識別子 |
| `ENABLE_SCHEDULED_SYNC` | 定期同期を許可する場合だけ`true` |

全処理は、実行時にバウンド先IDと`EXPECTED_SPREADSHEET_ID`が一致することを検証します。ID自体は画面や処理ログへ表示しません。

`config/clasp.staging.example.json`と`config/clasp.production.example.json`を参考に、実値入りの`.clasp.staging.json`と`.clasp.production.json`をローカルだけに作成します。これらと選択中の`.clasp.json`、`.clasprc.json`はignore対象です。

```sh
npm run select:staging
```

入力4タブは人が用意します。スクリプトは入力タブを自動作成しません。stagingでは`setupStagingSchema`、productionでは確認文字列を要求する`setupProductionSchema`を関数として実行し、マスター・出力・ログのスキーマだけを作成または検証します。通常同期はスキーマを作りません。

操作の順序は[運用フロー](docs/operation-flow.md)、production反映は[リリース手順](docs/release-runbook.md)を参照してください。

## メニューとトリガー

スプレッドシートを開くと`当日情報媒体AI`メニューが表示されます。事前チェック、ドライラン、同期、2種類の出力更新、全処理、ログ表示、環境表示を実行できます。

初期状態ではsimple triggerの`onOpen`以外を作りません。`installTriggers`を明示実行するとフォーム送信時トリガーを重複なしで作り、`ENABLE_SCHEDULED_SYNC=true`の場合だけ1時間ごとの時間主導トリガーも作ります。productionでのインストール・削除には確認ダイアログが必要です。トリガーはインストールした作成者の権限で動きます。

## デプロイ

通常のbound scriptなので、web app、Add-on、Apps Script API executable、versioned deploymentは作成しません。反映スクリプトは`clasp push`後に追跡用のApps Script versionを作るだけです。

- `npm run deploy:staging`: verify後にstagingを選択し、pushとGit SHA付きversion作成
- `npm run deploy:production`: `main`、clean worktree、verifyを確認し、対象環境とScript IDの一部を表示して、対話入力`PRODUCTION`が一致した場合だけpushとversion作成

productionスクリプトは`--force`を使いません。productionへの実行は、ユーザーがその操作を明示依頼した場合だけ許可されます。

## 設計上の仮定

不明点には次の安全側の仮定を置いています。

- `26参参フォーム回答`と`26運スタ企画フォーム回答`だけをマスターへ自動同期する。両タブではメールアドレス、団体名、企画名を必須とし、参加企画も必須だが、運スタ企画だけは固定値`運営スタッフ企画`をコード側で補う。運スタ企画の`所属局`は独立列へ保持し、追加前の過去回答では空欄を許容する。正式企画ID、販売物、画像リンクは任意。
- `26参参変更申請`と`26運スタ企画変更申請`は自由記述の変更内容を含むため、回答原本として保持し、自動でマスターへ上書きしない。権限者が内容を確認してマスターへ反映する。
- 同じ正式IDが通常提出2タブにある場合は同一企画とみなし、同じタブ内では後の行を採用する。正式IDがない重複候補は自動統合しない。
- 更新入力の空の所属局・販売物・画像リンクは既存値を消さない。削除が必要な場合は権限者がマスターで確認して明示的に修正する。
- `TMP-`は暫定管理ID専用の予約prefix。暫定キー衝突時は最初の1件だけを要確認として残し、後続を自動統合しない。
- 同じメールアドレスを持つ別キー、または参加企画・団体名・企画名が一致する暫定行はキー変更の疑いとして、新旧双方を要確認にし、自動統合しない。
- `同期済み`かつ`要確認`でない行だけを出力対象にする。確認中の情報を誤掲載しないための安全策。
- 飲食物判定は参加企画区分と販売物の有無だけを使う。詳細は`config.gs`と[列マッピング](docs/column-mapping.md)を同時に更新する。
- dry runは入力、マスター、出力を変更しないが、監査のため結果サマリーを`26処理ログ`へ記録する。
- `RELEASE_ID`未設定時は動作を止めず`UNSET`と記録する。production運用ではリリース前に必ず設定する。

## 障害時

自動実行を止める場合は、権限者が`uninstallTriggers`を実行します。入力タブや既存出力を消さず、ログのエラーコードと行番号・列名だけを調査します。復旧は[インシデント手順](docs/incident-runbook.md)、コードの切り戻しは[ロールバック手順](docs/rollback-runbook.md)に従います。
