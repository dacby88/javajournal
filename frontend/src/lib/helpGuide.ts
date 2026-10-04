export interface HelpTopic {
  id: string;
  title: string;
  paragraphs: string[];
  steps?: string[];
  tips?: string[];
  warning?: string;
  links?: { label: string; to: string }[];
  keywords?: string[];
}

export interface HelpSection {
  id: string;
  title: string;
  description: string;
  topics: HelpTopic[];
}

export const helpSections: HelpSection[] = [
  {
    id: 'getting-started', title: 'Getting started',
    description: 'Learn the data model and get from a broker report to your first dashboard.',
    topics: [
      {
        id: 'first-session', title: 'Your first session',
        paragraphs: ['Java Journal is a trading journal and analysis tool. It imports execution reports, groups fills into trades, and calculates performance. It does not place orders or change positions at your broker.', 'The public edition is a self-hosted, single-owner installation. Bundled local, network or cloud Postgres is selected in server configuration before the application starts. Never enter database credentials in the browser.'],
        steps: ['Sign in with your existing username and password. On a new installation, enter the operator-configured SETUP_TOKEN in the Setup token field and create the owner login. This token comes from the private environment configuration, is not the database password, and is not needed for normal login.', 'On the dashboard, open the username menu and choose Manage Accounts. Create an account for the broker account or strategy you want to track.', 'Choose the account’s broker format or custom mapping, and check the report timezone.', 'Choose Import CSV from the username menu, select the destination account, and review the file preview before importing.', 'Check the Trades and Executions pages, then return to the dashboard and choose the accounts and reporting period you want to analyze.'],
        tips: ['You can return to this guide from User Help Guide in the username menu. On a small screen, open the hamburger menu first.', 'Use a small report first so you can compare the resulting trades with the broker statement.'],
        links: [{ label: 'Open dashboard', to: '/' }],
        keywords: ['login', 'setup', 'setup token', 'SETUP_TOKEN', 'single-owner', 'Postgres', 'onboarding', 'beginner', 'start'],
      },
      {
        id: 'data-model', title: 'Accounts, executions, trades and positions',
        paragraphs: ['An account is the container for your imported data and calculation settings. An execution is one individual BUY or SELL fill, including its quantity, price, time, commission and cash movement. A trade groups related executions into a position or round trip.', 'A multi-leg trade can contain several option symbols. A trade is open while any symbol still has an outstanding quantity. An unmatched execution has not been linked to a trade; that is different from whether it is an opening or closing fill.'],
        tips: ['Ten execution rows do not necessarily produce ten trades.', 'The dashboard’s Open Trades / Positions card can show both open trades and unmatched positions. Open records are not the same as realized closed-trade performance.'],
        keywords: ['fills', 'orders', 'matched', 'unmatched', 'open', 'closed'],
      },
      {
        id: 'daily-routine', title: 'A useful daily workflow',
        paragraphs: ['Use the same routine to keep trade grouping, statistics and journals consistent.'],
        steps: ['Export a fresh execution-level report from the broker and retain the original file.', 'Import it into the correct account, checking the row preview and import result for skipped rows or warnings.', 'Review unmatched executions, open trades, quantities and timestamps. Correct grouping before interpreting metrics.', 'Add trade tags and trade notes, then select the day on the calendar and save your daily journal.', 'Refresh the dashboard, confirm its account selection and date range, and optionally export a CSV or take a snapshot.'],
        warning: 'Reprocess & Recalc is a rebuild operation, not a routine refresh. It can replace manually arranged trades and their associated annotations.',
      },
    ],
  },
  {
    id: 'accounts', title: 'Accounts and calculation settings',
    description: 'Organize broker accounts and understand the settings that change your analysis.',
    topics: [
      {
        id: 'manage-accounts', title: 'Create, edit or deactivate an account',
        paragraphs: ['Open Manage Accounts from the dashboard username menu. Account names identify records throughout the app, including the trade-detail header. The broker account number is a reference for the imported account, not your application login.'],
        steps: ['Create an account with a recognizable name and optional description or account number.', 'Select the built-in Broker Format or a Broker Import Mapping that matches its reports.', 'Set the account timezone and calculation settings, then save.', 'Use the edit button to change account details. The active setting determines whether it appears in the normal active-account lists.'],
        warning: 'The account delete action deactivates the account rather than erasing its trading history. Do not use it as a way to delete an import or reset trades.',
        tips: ['Inactive-account visibility depends on the page’s account controls. Check active status if an account appears to be missing.', 'Selecting multiple dashboard accounts aggregates their data; it does not move records between accounts.'],
      },
      {
        id: 'account-timezone', title: 'Choose the correct report timezone',
        paragraphs: ['The account timezone helps the importer interpret report timestamps. Set it to the timezone represented by the broker export, rather than choosing a timezone to make a trade appear on a preferred date.', 'Date-only reports do not provide enough information for reliable entry-hour or minute-duration analysis. A displayed date is not a substitute for an actual execution timestamp.'],
        tips: ['Compare one known execution against the original report before importing a large history.', 'Changing account settings does not automatically repair previously imported timestamps. Review existing executions and the implications of reprocessing before making historical corrections.'],
        keywords: ['dates', 'time zones', 'eastern', 'UTC', 'hour', 'timestamp'],
      },
      {
        id: 'account-risk-settings', title: 'Starting Account Value and Sortino target',
        paragraphs: ['Starting Account Value is the equity before the imported trading history. It supplies an equity base for Sharpe and annual percentage Sortino benchmarks; it is not a live broker balance and does not automatically include deposits or withdrawals.', 'Choose Fixed $ for a daily dollar benchmark or Annual % for a yearly return benchmark. Annual percentages are compounded into daily rates as (1 + annual percentage / 100)^(1 / 252) - 1.', 'Each daily percentage target uses that account’s starting value plus cumulative realized net P&L before the day being measured, including history before the selected report period. Realized P&L updates later days; estimated open P&L is not included.'],
        steps: ['Edit the account in Manage Accounts and open its account-defaults settings.', 'Enter a positive Starting Account Value representing equity before your imported history. Do not enter a current balance that already includes the same imported profits.', 'Choose Annual % and enter the yearly benchmark, or keep Fixed $ for a daily dollar target. Zero is a valid benchmark.', 'Save, refresh the dashboard and compare metrics using the same dates and tag filters.'],
        tips: ['With multiple accounts selected, each account’s daily dollar benchmark is calculated from its own equity and percentage, then the benchmarks are summed. Different annual percentages are not simply averaged.', 'Existing saved percentage numbers are now interpreted as annual: a saved 5 means 5% per year, not 5% per day. Review saved account benchmarks after updating.', 'Tag filters affect the card’s measured trade P&L, but the account equity base still includes all of that account’s realized P&L. Legacy unassigned trades cannot be allocated to a particular account’s equity.', 'Do not assume the app automatically converts different account currencies into one reporting currency. Check the amounts and currency conventions in the original reports.'],
        keywords: ['sharpe', 'sortino', 'equity', 'balance', 'currency', 'risk', 'annual', 'yearly', '252', 'benchmark', 'cumulative pnl'],
      },
    ],
  },
  {
    id: 'csv-imports', title: 'CSV imports and custom mappings',
    description: 'Choose a format, validate rows and interpret the import result before matching trades.',
    topics: [
      {
        id: 'prepare-csv', title: 'Prepare the right kind of broker report',
        paragraphs: ['Import execution-level CSV reports: one row per BUY or SELL fill. A completed-trade summary, cash-balance report or screenshot is not an execution report.', 'Choose the matching built-in format, such as Interactive Brokers, Schwab or Tastytrade, when available in your installation. Other layouts can use a custom mapping. The importer’s template download shows the expected execution fields.'],
        tips: ['Useful fields include symbol, side, quantity, price, trade date, execution timestamp, commission, net cash and stable broker execution identifiers.', 'Option reports also need enough contract information to distinguish expiry, strike, call/put and multiplier.', 'Keep large files below the backend’s 16 MB request limit; splitting exports into smaller date ranges can make validation and troubleshooting easier.'],
        warning: 'Keep the original broker CSV as your source of truth. The app’s trade-summary export is not a replacement execution report for reimporting.',
        keywords: ['IB', 'IBKR', 'Schwab', 'Tastytrade', 'Tradier', 'template', 'file', 'report'],
      },
      {
        id: 'import-preview', title: 'Import a CSV and review its preview',
        paragraphs: ['Import CSV opens a guided selection, validation, preview and import flow. The account shown on the dashboard is only a default; verify the actual destination in the import dialog.'],
        steps: ['Choose Import CSV from the username menu and select the destination account.', 'Choose CSV Format or Custom Mapping, or leave selection on Auto-detect from account to use the account configuration.', 'Drop the CSV into the upload area or browse for the file.', 'Review the detected fields, expected executions, duplicate information and row-level warnings.', 'Check the rows you want to include. Use selection controls to exclude irrelevant or invalid rows.', 'Choose the matching mode, then click Import with the selected-row count.', 'Read the result: executions added, trades created or updated, and any warnings or errors.'],
        tips: ['Changing the selected account resets a pending upload so you can validate it against the correct configuration.', 'Choosing an explicit CSV format clears the custom-mapping selection, and choosing a custom mapping clears the explicit format.'],
      },
      {
        id: 'duplicates-errors', title: 'Duplicates, skipped rows and partial success',
        paragraphs: ['The importer uses broker identifiers and available execution data to detect duplicates. A repeated export can therefore add fewer executions than the number of rows selected.', 'Import Partially Successful means some data may already have been saved. Review the reported row errors before retrying the entire file. A successful import count is not the same as a completed-trade count.'],
        steps: ['Read the result panel and identify exactly which rows were skipped or failed.', 'Compare those rows with Executions using the account, symbol, date and broker identifier.', 'Correct a mapping or invalid input only after understanding the warning.', 'Validate a small corrected file and import the intended rows, rather than repeatedly importing a large report without checking the result.'],
        tips: ['Stable broker execution IDs improve duplicate detection. Edited IDs, different account selection or materially changed fields can make a row look new.', 'A missing closing fill can leave a correctly imported trade open. That is not necessarily an import failure.'],
        keywords: ['duplicate', 'skipped', 'partial', 'failed', 'invalid', 'warnings'],
      },
      {
        id: 'custom-mappings', title: 'Create and use a Broker Import Mapping',
        paragraphs: ['Custom mappings translate a report’s column headings and values into Java Journal execution fields. They are reusable templates, not copies of your trades.'],
        steps: ['Open Manage Accounts, expand Broker Import Mappings and choose New.', 'Name the mapping. Optionally choose a Base Template to start from a known broker format.', 'Upload an Example CSV File to inspect the detected header and sample values.', 'Map every required field and the useful optional fields to the correct source columns.', 'Review any value translations and parser settings exposed by the editor, especially side values and date/time handling.', 'Save the mapping and assign it to the account or select it explicitly in Import CSV.', 'Validate a small sample and verify quantity, price, commissions, cash signs and timestamps before importing the full history.'],
        warning: 'Changing a mapping does not automatically rewrite data that was already imported. Deleting a mapping can affect accounts that depend on it; review those accounts before confirming.',
        keywords: ['headers', 'columns', 'custom format', 'parser', 'value mappings', 'template'],
      },
    ],
  },
  {
    id: 'matching', title: 'Automatic and manual matching',
    description: 'Decide which executions belong together, including multi-leg and partial-close trades.',
    topics: [
      {
        id: 'automatic-matching', title: 'How automatic matching groups executions',
        paragraphs: ['Automatic processing groups executions into trades using account, instrument and position activity. A position can stay within an open trade until its quantity is closed. One broker order can have several fills, and one trade can contain multiple legs.', 'Matching depends on the actual report fields and timestamps. If you need a different grouping, review executions and use manual matching or the trade-detail tools rather than assuming row order alone defines a trade.'],
        tips: ['Check that all required opening and closing fills have been imported for the same account.', 'Do not combine unrelated strategies just because their fills were close together in time.'],
        keywords: ['FIFO', 'round trip', 'position', 'fills', 'legs', 'grouping'],
      },
      {
        id: 'timestamp-matching', title: 'Advanced timestamp matching for spreads',
        paragraphs: ['When advanced cross-symbol matching is enabled and the file contains real execution times, executions sharing a timestamp can be grouped into a multi-leg trade. Date-only data is not enough to identify simultaneous fills.', 'A same-timestamp group joins an existing trade only when the group represents closing activity for symbols already held by that trade; new opening groups can become separate trades.'],
        tips: ['Verify the report’s timestamp precision and timezone before relying on timestamp grouping.', 'If unrelated fills share a coarse timestamp, manual matching gives you direct control over the grouping.'],
        keywords: ['advanced', 'timestamp', 'spread', 'straddle', 'strangle', 'iron condor', 'multi-leg'],
      },
      {
        id: 'manual-matching', title: 'Match executions manually during import',
        paragraphs: ['Manual matching imports executions without automatically arranging them into trades, then opens the matcher. Manual mode takes precedence over automatic advanced matching.'],
        steps: ['Select manual matching in the import preview and import the selected rows.', 'In the matcher, select the executions that belong to one position or strategy.', 'Choose Create trade to start a trade from that selection.', 'To add fills to an existing position, select an open trade and choose Assign to that trade.', 'Repeat as needed and choose Done. Remaining executions stay unmatched and can be handled later from Executions.'],
        tips: ['The matcher lists execution date/time, symbol, side, quantity, price, commission and net cash to help you compare fills.', 'When assignment closes a trade, it is removed from the matcher’s open-trade list; it is still available in Trades.'],
        warning: 'Review the destination account and trade number before assignment. These actions change journal grouping, not broker positions.',
      },
    ],
  },
  {
    id: 'dashboard', title: 'Dashboard controls and charts',
    description: 'Choose the correct reporting scope and understand why cards can show different subsets.',
    topics: [
      {
        id: 'dashboard-account-period', title: 'Account selection, periods and refresh',
        paragraphs: ['Use the account selector to choose one or several accounts. An empty selection means All Accounts; selecting several accounts aggregates their results. You can search by account name or number.', 'Check Obfuscate account names inside the account dropdown to show up to the first three characters followed by exactly five asterisks, such as Alp*****. This masks the dropdown rows and the single-account selector label on the dashboard, Trades and Executions pages, including mobile selectors. The preference is remembered in this browser and stays synchronized between selectors and tabs.', 'Use 1 Week, 1 Month, 3 Months, 6 Months, 1 Year, YTD, Since Inception or Custom Range to set the reporting period. For Custom Range, choose both dates and apply the range.'],
        tips: ['The account selection is kept in the browser session. A fresh session with no persisted selection can default to the first active account.', 'Desktop Trades and Executions shortcuts carry the dashboard’s account selection into those pages. Table filters are also separate controls, so check their applied values.', 'Refresh fetches the current data; it does not rematch trades or rebuild calculations from edited executions.', 'Name obfuscation is a display preference for account selectors only: it does not rename records or hide names in other views, exports or the underlying data. Search still uses the full account name/number; accounts with the same first three characters can look alike when masked. If browser storage is unavailable, masking works for the current page but may not survive a reload.', 'Some dashboard view settings can reset when you leave and return. Recheck the selected period and card filters before comparing results.'],
        links: [{ label: 'Open dashboard', to: '/' }],
        keywords: ['filter', 'date range', 'all accounts', 'multiple accounts', 'refresh', 'YTD', 'obfuscate', 'mask', 'privacy', 'hidden names'],
      },
      {
        id: 'dashboard-card-settings', title: 'Show, hide, reorder and filter cards',
        paragraphs: ['Dashboard card visibility controls let you choose which analyses are shown. Cards expose move-left and move-right controls to change their display order. Settings icons on supported cards open Card Settings.', 'Several analytical cards share Include Tags and Untagged trades settings. Defaults select non-Margin tags and exclude untagged trades, so these cards can contain fewer trades than the main summary.'],
        steps: ['Use the dashboard’s card visibility controls to reveal or hide an analysis.', 'Use a card’s move arrows to arrange the current view.', 'Open Card Settings to select the tag subset or include untagged trades.', 'Select All includes the available tags and untagged records; Clear All removes those selections; Reset Default restores the non-Margin tagged subset.', 'Compare cards only after checking their dataset and filters.'],
        tips: ['The Only intraday trades control is displayed in Card Settings, but this version does not apply it as a universal filter to every calculation. Use the Trades date/time controls to inspect a precise subset.', 'If an expectancy or ratio card is empty while the main summary has results, check tags and the Untagged trades setting first.'],
        keywords: ['visibility', 'layout', 'reorder', 'settings', 'margin', 'untagged', 'intraday'],
      },
      {
        id: 'dashboard-charts', title: 'Read the charts and drill into the data',
        paragraphs: ['Cumulative P&L is a running total of journal profit/loss, not a complete broker equity statement. Drawdown shows the decline from prior cumulative peaks. Weekly/Monthly P&L groups results by the chosen histogram interval.', 'P&L by Symbol and P&L by Tag group results by instrument and classification. Entry-hour, activity and duration analyses depend on the relevant timestamps and their own calculation subsets.'],
        tips: ['Hover chart elements and information icons for values and explanations.', 'The Exclude SPX control affects the symbol chart; it is not a global account or trade deletion filter.', 'A trade with several tags can contribute to more than one tag bar, so adding tag bars is not necessarily the overall account total.', 'Open Trades / Positions distinguishes trade and position rows. A trade row opens its details; an unmatched position can open execution editing.'],
        keywords: ['cumulative', 'drawdown', 'weekly', 'monthly', 'symbol', 'SPX', 'chart', 'histogram'],
      },
      {
        id: 'dashboard-calendar-snapshot', title: 'Calendar, summary and snapshots',
        paragraphs: ['Use the calendar’s month controls and select a day to open its journal, summary and trades. The calendar has its own recent-history view and is account-filtered; it is not always restricted to the headline reporting period.', 'Snapshot captures the dashboard content into an image preview. You can Download Image as PNG or use Copy to Clipboard where supported by the browser.'],
        tips: ['Check the daily dialog’s Exclude Margin setting when its totals differ from another view.', 'If copying a snapshot is blocked by browser permissions or protocol restrictions, use the PNG download.', 'Snapshots and exports may contain account names and trading results. Review them before sharing.'],
        keywords: ['calendar', 'month', 'day', 'snapshot', 'PNG', 'clipboard', 'summary'],
      },
    ],
  },
  {
    id: 'metrics', title: 'Performance metrics explained',
    description: 'Interpret counts, profit/loss, risk ratios and data limitations without mixing datasets.',
    topics: [
      {
        id: 'metric-counts-pnl', title: 'Trade counts, win rate and gross versus net P&L',
        paragraphs: ['Headline realized performance is based on closed trades in the selected dataset. A winning trade has positive net P&L, a losing trade has negative net P&L, and a break-even trade has zero net P&L. Win rate is the winning-trade share of that dataset.', 'Gross P&L is before the trade’s commissions; net P&L reflects the stored net result. Commission signs and cash fields must match the broker format, especially for options and multi-leg trades.'],
        tips: ['An execution count is a fill count, not a trade count.', 'An open trade’s cash flow or estimated open P&L should not be treated as a realized closed-trade result.', 'Confirm account, period, status and tag filters before comparing totals with a broker statement.'],
        keywords: ['pnl', 'profit', 'loss', 'win rate', 'break even', 'commission', 'realized'],
      },
      {
        id: 'metric-expectancy', title: 'Expectancy, average win/loss and profit factor',
        paragraphs: ['Expectancy per Trade describes average net profit/loss per trade in that card’s filtered dataset. Average Win and Average Loss describe the corresponding winning and losing subsets.', 'Profit factor compares gross profits with the magnitude of gross losses. Ratios can be uninformative when a dataset has no losses, very few trades or missing values; a zero/default display is not proof of a risk-free strategy.'],
        tips: ['Use a reasonable sample size and a consistent dataset.', 'The expectancy card’s shared tag settings can exclude Margin and untagged trades even when headline totals include them.'],
        keywords: ['expectancy', 'average win', 'average loss', 'profit factor', 'sample size', 'pnl'],
      },
      {
        id: 'metric-risk-ratios', title: 'Sharpe and Sortino ratios',
        paragraphs: ['Sharpe measures return relative to variability across daily results. When Starting Account Value is configured, the app can use an equity-based return series rather than just raw daily dollar P&L.', 'Sortino compares closing-date daily net P&L with each day’s combined benchmark. Annual % becomes a daily percentage of beginning-of-day equity; Fixed $ stays a daily amount. Downside deviation uses squared shortfalls below each day’s target, divided by all measured closing days.', 'The displayed Sortino ratio is average daily excess P&L divided by daily downside deviation; it is not annualized. Avg Daily Target shows the mean dollar benchmark over the measured days, so it can change as account equity changes.'],
        tips: ['Very short histories or no measurable downside can produce zero/default ratios; that is not proof of a risk-free strategy.', 'A missing starting value, unavailable equity history or nonpositive account equity in annual mode shows a warning and a dash rather than silently substituting a daily dollar benchmark.', 'No matching closed trades in the card’s tag subset produces an empty/zero result rather than a ratio from a differently filtered dataset.', 'Set a positive Starting Account Value and a realistic annual percentage benchmark in Manage Accounts, then compare consistent periods.', 'These are descriptive statistics from imported data, not forecasts or guarantees.'],
        keywords: ['sharpe', 'sortino', 'risk', 'target', 'standard deviation', 'annualized', 'returns'],
      },
      {
        id: 'metric-streak-duration', title: 'Streaks, entry hours and duration',
        paragraphs: ['Streak Analysis counts consecutive winning or losing days, rather than simply counting consecutive individual trades. A break-even day resets the streak calculation.', 'Duration analysis describes how long trades were held. Entry-hour and intraday charts require reliable execution times. A broker report containing dates only cannot support precise minute-by-minute analysis.'],
        tips: ['A multi-leg position’s grouping affects its entry, exit and duration.', 'Use the Trades time and duration filters to inspect the underlying rows before drawing conclusions from a chart.'],
        keywords: ['streak', 'consecutive', 'days', 'duration', 'minutes', 'hours', 'intraday'],
      },
      {
        id: 'metric-data-limitations', title: 'MAE/MFE and other data limitations',
        paragraphs: ['MAE means Maximum Adverse Excursion: the worst move against a trade while it was held. MFE means Maximum Favorable Excursion: the best unrealized opportunity during that period.', 'The MAE/MFE analysis is hidden by default. Current imported execution data does not by itself reconstruct a full intratrade price path, and these fields can be placeholders or defaults. Do not interpret zero values as proof that no adverse or favorable excursion occurred.'],
        tips: ['Real-time prices, cash transfers, interest, corporate actions and foreign-exchange conversion may not be represented by an execution-only history.', 'Use the broker statement to reconcile official cash balances and realized results; use the journal to analyze the records actually imported.'],
        keywords: ['mae', 'mfe', 'capture', 'recovery', 'efficiency', 'missing data', 'placeholder'],
      },
    ],
  },
  {
    id: 'trades', title: 'Trades list and filtering',
    description: 'Find trades, compare reporting dates and export the currently applied dataset.',
    topics: [
      {
        id: 'trade-filters', title: 'Find trades with the right filters',
        paragraphs: ['Trades provides symbol, underlying, side, accounts, tags, dates, time, duration and status controls. Edit the filter controls, then use Apply Filters; the displayed results and exports follow the applied filters, not merely values typed into the form.'],
        steps: ['Choose the relevant accounts, symbol/underlying and LONG or SHORT side.', 'Choose tag matching: ALL for every selected tag, ANY for at least one, or the untagged option for trades with no tags.', 'Choose start/end dates and Date Filter Mode: Exit Date for closures, Entry Date for openings, or Active Date for positions active in the interval.', 'Choose All, Open or Closed status and any entry/exit time or duration limits.', 'Apply Filters, then sort supported table columns or use pagination to review rows. Reset filters when you want to broaden the dataset.'],
        tips: ['A trade can be active across several days but realize its result on the closing date.', 'Opening, closing and active-date views answer different questions; their row counts can legitimately differ.'],
        links: [{ label: 'Open trades', to: '/trades' }],
        keywords: ['filters', 'apply', 'reset', 'AND', 'OR', 'active date', 'entry date', 'exit date', 'pagination'],
      },
      {
        id: 'trade-create-combine', title: 'Create a trade or combine trade records',
        paragraphs: ['Manual trade creation starts a record that you can populate with executions. Combining selected trades creates a grouped trade; it does not submit any broker order.'],
        steps: ['Choose the appropriate account before creating a manual trade.', 'Add the intended executions from the trade-detail page or assign them from Executions.', 'To combine existing trade records, select their row checkboxes and choose the combine action.', 'Read the confirmation and check that the selected records represent the same intended strategy.', 'Open the resulting trade to verify symbols, quantities, dates, P&L and tags.'],
        warning: 'Combining changes grouping and analytics. Keep unrelated positions and different accounts separate. Uncombine is available only when combine history supports restoring the original records.',
        keywords: ['create trade', 'manual trade', 'combine trades', 'spread', 'group'],
      },
      {
        id: 'trade-export-bulk-recalc', title: 'Export CSV and bulk Recalc P&L',
        paragraphs: ['Export CSV requests trades matching the applied filters, not just the currently visible page. Open-trade exports can have a blank estimated P&L when a quote is unavailable.', 'Recalc P&L is broader than selecting a few table rows: its confirmation identifies the account scope, and it recalculates trades from their linked executions. It can then offer a separate statistics recalculation.'],
        tips: ['Use exported summaries for analysis or sharing, but retain original execution reports for recovery and reconciliation.', 'Check the confirmation’s account scope carefully; a narrow date filter or row selection should not be assumed to limit the bulk recalculation.'],
        warning: 'Bulk recalculation requires typing RECALC. Review the scope and keep a backup before using it on a large history.',
        keywords: ['export', 'download', 'CSV', 'recalc', 'RECALC', 'bulk', 'statistics'],
      },
    ],
  },
  {
    id: 'trade-details', title: 'Trade details and corrections',
    description: 'Inspect the linked fills, preserve custom names and make controlled grouping corrections.',
    topics: [
      {
        id: 'trade-detail-overview', title: 'Read the trade header, P&L and position tables',
        paragraphs: ['Open a trade from its number or linked row. The top header shows the trade number and associated account; combined trades also show a Combined badge.', 'Closed trades show realized net and gross P&L and commissions. For an open trade, Net Cash is cash movement from its executions, while open P&L is a separate estimate when quote data is available.'],
        tips: ['Open and closed position tables summarize symbol quantities and cash flows. Contract quantity totals can be gross counts across legs, not the net strategy size.', 'The execution table’s symbol-status indicator describes whether that symbol has remaining quantity; the Opening/Closing field is a separate execution classification.', 'A blank or dash for an open quote means unavailable, not necessarily zero profit/loss. Delayed option quotes are not live broker marks.'],
        keywords: ['trade number', 'account name', 'net cash', 'open pnl', 'positions', 'commissions', 'quote'],
      },
      {
        id: 'trade-description-tags-notes', title: 'Descriptions, side, tags and trade journals',
        paragraphs: ['Trade descriptions can be generated from symbols, expiries, strikes and spread structure. Editing a description enables the override that preserves the custom name against automatic regeneration.', 'Trade tags classify a trade for filtering and analysis. A trade journal stores notes about that particular position, separately from the calendar’s daily journal.'],
        steps: ['Use the description edit control, enter the name and save it.', 'Check Override auto-description when you want to preserve a custom description; turning it off allows future automatic updates.', 'Use the side control to correct LONG/SHORT classification when appropriate.', 'Edit tags and add trade-journal content, then explicitly save the journal.', 'Review the resulting trade after changing linked executions or recalculating it.'],
        tips: ['Changing a descriptive field does not submit an order or change the actual broker position.', 'A trade number is a journal record identifier, not necessarily the broker’s order or execution ID.'],
        keywords: ['description', 'name', 'override', 'long', 'short', 'journal', 'notes', 'tags'],
      },
      {
        id: 'trade-linked-executions', title: 'Add, remove or correct linked executions',
        paragraphs: ['The linked-execution table is the source for trade grouping and cash-based calculations. Add Executions lets you choose unmatched fills for the trade; sortable columns help compare time, symbol, side and amounts.', 'Remove from Trade detaches selected executions without deleting them and recalculates the remaining trade. Detached fills become unmatched and can be assigned elsewhere.'],
        steps: ['Check the trade number and account before choosing executions.', 'Add the intended unmatched executions or select linked rows to remove.', 'Review the confirmation and inspect the resulting symbol quantities and status.', 'If an execution belongs to another trade, review the conflict before any Reassign & Recalculate action.'],
        warning: 'You cannot remove the only execution or every execution from a trade using Remove from Trade. Use Unmatch Trade when the whole grouping should be dismantled. Reassignment can affect both the current and previous trade.',
        keywords: ['add executions', 'remove', 'unlink', 'detach', 'assign', 'reassign', 'conflict'],
      },
      {
        id: 'trade-recalc-unmatch-delete', title: 'Recalculate, unmatch, delete or uncombine',
        paragraphs: ['Recalculate P&L rebuilds the selected trade’s result from its linked executions using net cash. The Also recalculate account stats checkbox controls whether its account’s daily statistics are refreshed at the same time.', 'Unmatch Trade deletes the trade grouping and releases its executions for processing again. Delete Trade permanently removes the trade record but preserves its linked executions. Uncombine restores original records only when the trade’s combine history allows it.'],
        tips: ['After editing a fill’s price, quantity, commission or net cash, recalculate the affected trade and relevant statistics rather than merely refreshing the page.', 'If account statistics are not recalculated, the updated trade and daily summary can temporarily disagree.'],
        warning: 'Deleting or rebuilding a trade can remove its trade-specific notes, tags or custom grouping. Export or back up important annotations before confirming destructive actions.',
        keywords: ['recalculate', 'unmatch', 'delete', 'uncombine', 'undo', 'stats', 'net cash'],
      },
    ],
  },
  {
    id: 'executions', title: 'Executions and split fills',
    description: 'Inspect raw fills and make corrections before rebuilding the affected trades.',
    topics: [
      {
        id: 'execution-filters', title: 'Find and inspect executions',
        paragraphs: ['Executions shows individual imported or manually entered fills. Filters include account, symbol/underlying, BUY/SELL side, asset class, dates and matched state. Apply the filters to update the table.', 'Matched means linked to a trade. Opening/Closing describes position activity and is not the same as matched/unmatched. Click the linked trade control to inspect its grouping.'],
        tips: ['Review account, signed quantity, price, multiplier, commission, net cash and timestamp together.', 'A security symbol identifies an individual contract; the underlying can group different contracts on the same instrument.'],
        links: [{ label: 'Open executions', to: '/executions' }],
        keywords: ['fills', 'buy', 'sell', 'matched', 'unmatched', 'asset class', 'underlying'],
      },
      {
        id: 'execution-add-edit', title: 'Add or edit an execution',
        paragraphs: ['Add Execution creates a journal fill manually. Edit lets you correct the stored account/instrument, trade details, time, cash and commission fields exposed by the form. It does not amend the broker’s records.'],
        steps: ['Choose the correct account and review the instrument and option fields.', 'Enter the BUY/SELL side, quantity, price and date/time using the source report.', 'Verify multiplier, commission, currency and net-cash conventions; these fields affect trade results.', 'Save and inspect any trade linked to the execution.', 'Recalculate the affected trade and account statistics when needed to propagate financial corrections.'],
        warning: 'Do not change cash signs or contract multipliers just to make a desired P&L appear. Reconcile against the original execution report.',
        keywords: ['add execution', 'edit', 'price', 'quantity', 'multiplier', 'commission', 'currency'],
      },
      {
        id: 'execution-assign-combine', title: 'Combine executions or assign them to a trade',
        paragraphs: ['Select execution-row checkboxes to combine the chosen fills into a trade, or choose Assign to Trade to link them to an existing record. The assignment dialog also lets you create a destination trade.', 'Check the destination account and trade number before confirming. Grouping a fill is a journal operation; no broker transaction is performed.'],
        tips: ['Keep all legs of the intended strategy together, but do not mix unrelated trades just because they share an underlying.', 'Use the trade-detail removal controls or Unmatch Trade when an existing grouping needs to be undone before reassignment.'],
        keywords: ['combine executions', 'assign to trade', 'link', 'manual matching'],
      },
      {
        id: 'execution-split', title: 'Split an execution into smaller quantities',
        paragraphs: ['Split is available for an unmatched execution with enough whole-unit quantity. It is useful when one broker fill must be allocated across different journal trades.', 'The split creates parts whose quantities sum to the original quantity and allocates commission, amount and net cash proportionally. Rounding adjustments are applied so the allocated totals remain consistent.'],
        steps: ['Unmatch the execution from its trade first if it is currently linked.', 'Choose Split execution and enter at least two positive whole-unit quantities.', 'Confirm that the remaining quantity is zero and review the cash/commission preview.', 'Confirm the split, then assign the resulting executions to the intended trades.'],
        warning: 'Splitting changes the journal’s execution records. This version’s split form does not accept fractional child quantities. Keep the original broker report for reconciliation.',
        keywords: ['split', 'contracts', 'partial', 'allocate', 'pro rata', 'rounding'],
      },
      {
        id: 'execution-delete-export', title: 'Delete or export execution records',
        paragraphs: ['Export CSV uses the page’s applied filters to retrieve the matching execution data. Deleting an execution removes the underlying journal fill, unlike removing it from a trade.', 'The delete confirmation explains whether the execution belongs to a trade. Deleting a linked fill can recalculate trades and statistics; deleting an unmatched fill does not necessarily affect existing trade summaries.'],
        warning: 'Delete is not a way to correct grouping. Prefer detach/reassign when the fill is valid, and delete only when the underlying record itself is wrong or unwanted.',
        keywords: ['delete execution', 'export', 'CSV', 'download', 'remove'],
      },
    ],
  },
  {
    id: 'journals', title: 'Daily journals and event tags',
    description: 'Keep daily observations separately from individual trade notes.',
    topics: [
      {
        id: 'daily-journal', title: 'Write and save a daily journal',
        paragraphs: ['Choose a day on the dashboard calendar to open the daily dialog. Its Journal, Summary and Trades tabs keep notes and trading records for that date together.', 'The daily journal is associated with the date, rather than being a separate note for each selected account. Changing the account filter does not create a different daily journal for the same date.'],
        steps: ['Open the calendar day and choose Journal.', 'Write your plan, observations, mistakes or review in the rich-text editor.', 'Choose any Eco Data/News event tags that describe that day.', 'Click Save Journal and wait for the saved confirmation before closing.', 'Use Summary and Trades to compare notes with the day’s recorded activity.'],
        tips: ['An empty day can still have a journal entry.', 'A trade’s own journal is edited and saved on its trade-detail page.'],
        keywords: ['daily notes', 'journal', 'calendar', 'save', 'economic', 'news', 'date'],
      },
      {
        id: 'daily-summary', title: 'Compare daily summary and trade results',
        paragraphs: ['The daily dialog follows the dashboard’s account selection for its trade data. Its Exclude Margin control can change the subset being summarized independently of other dashboard cards.', 'For larger days, use the full Trades page and its date/status filters to inspect all matching records rather than relying only on the day-dialog list.'],
        tips: ['Check whether you are comparing realized results, open trades, net cash or an estimated open mark.', 'Calendar results and headline-period totals can differ because their time windows and datasets are not identical.'],
        keywords: ['day total', 'summary', 'margin', 'date filter', 'calendar'],
      },
    ],
  },
  {
    id: 'tags', title: 'Trade tags and tag settings',
    description: 'Classify trades and daily events without confusing their different uses.',
    topics: [
      {
        id: 'trade-tags', title: 'Create, apply and maintain trade tags',
        paragraphs: ['Choose Tag Settings from the username menu to create or edit trade-tag names, colors and descriptions. Apply tags to trades from their list/detail controls.', 'Use consistent names for strategies, setups, mistakes or risk categories. Trades filters support ALL/ANY tag matching, and several dashboard cards use a shared tag subset.'],
        tips: ['Margin has special significance in default analytical-card filters and the daily dialog’s exclusion control.', 'Untagged trades are excluded from some card defaults; enable them explicitly when you want the full eligible dataset.', 'Multiple tags on one trade can make tag-chart totals overlap.'],
        warning: 'Deleting a trade tag removes that tag from trades that use it. It does not delete the trades themselves.',
        links: [{ label: 'Open tag settings', to: '/settings' }],
        keywords: ['strategy', 'color', 'classification', 'margin', 'untagged', 'AND', 'OR'],
      },
      {
        id: 'event-tags', title: 'Trade tags versus event tags',
        paragraphs: ['Trade tags describe a trade and participate in trade filtering and performance analysis. Event tags describe a day’s economic data, news or market context and are selected in the daily journal.', 'Manage each category in its corresponding Tag Settings tab. Similar names do not make a trade tag and event tag interchangeable.'],
        warning: 'Deleting an event tag removes its journal associations. Save or export important context before reorganizing a tagging system.',
        keywords: ['event tags', 'news', 'economic', 'daily journal', 'classification'],
      },
    ],
  },
  {
    id: 'maintenance', title: 'History, recalculation and safe maintenance',
    description: 'Know the difference between refreshing a view, recalculating numbers and rebuilding trades.',
    topics: [
      {
        id: 'import-history', title: 'Review import history and remove a bad import',
        paragraphs: ['Manage Accounts includes an Import History section with the imported file, account, status and execution count. Use it to trace where records came from before attempting corrections.', 'Removing an import can remove its imported executions and associated derived records. Read the confirmation and review affected trades, especially if they contain fills from several reports.'],
        warning: 'Keep the original report and a backup before removing an import. This is a data-removal action, not simply hiding a file from the history list.',
        keywords: ['history', 'import history', 'remove import', 'duplicate file', 'backup'],
      },
      {
        id: 'refresh-recalculate-reprocess', title: 'Refresh, Recalc P&L and Reprocess & Recalc',
        paragraphs: ['Refresh only fetches the current stored data. Recalculate P&L rebuilds numerical results from the executions linked to existing trades. Statistics recalculation updates daily and aggregate summaries.', 'Reprocess & Recalc, available in Manage Accounts, deletes the selected account’s trades, rematches its executions and recalculates statistics. It can change trade IDs, grouping, descriptions and the relationship to annotations.'],
        steps: ['Use Refresh when imported or saved data is not yet reflected in the view.', 'After editing financial fields, recalculate the affected trade and its account statistics.', 'Use a full-account rebuild only when the matching itself needs rebuilding and you have reviewed the consequences.', 'For Reprocess & Recalc, choose the account in Manage Accounts, read Delete all trades and reprocess?, and confirm only after backing up important records.'],
        warning: 'A rebuild can replace manual combinations, tags, notes and custom descriptions. Do not use it as the first troubleshooting step for a display filter problem.',
        keywords: ['reprocess', 'rebuild', 'recalc', 'refresh', 'statistics', 'reset'],
      },
      {
        id: 'protect-data', title: 'Protect your reports, journals and exports',
        paragraphs: ['Retain original broker execution reports and keep database backups through your installation’s administrator. CSV summaries and PNG snapshots are useful for analysis, but they do not preserve every relationship, setting or journal entry.', 'Do not post passwords, broker account numbers or private reports when asking for help. A small synthetic example, action description and redacted error are usually enough to explain a problem.'],
        tips: ['Before deleting, splitting, reassigning or rebuilding records, verify the account and selected rows.', 'Redact account names/numbers and results from screenshots when appropriate.', 'Exports are not automatic full-database backups.'],
        keywords: ['privacy', 'security', 'backup', 'restore', 'sharing', 'export', 'snapshot'],
      },
    ],
  },
  {
    id: 'appearance-login', title: 'Appearance, password and logout',
    description: 'Adjust the interface and manage access to your journal.',
    topics: [
      {
        id: 'themes-mobile', title: 'Themes and small-screen navigation',
        paragraphs: ['The dashboard theme control offers Java, Dark, Earth, Terminal and Tokyo. Theme selection is stored in the browser, so another device can use a different theme.', 'On smaller screens, open the hamburger menu for account/date controls, Trades, Executions, Refresh, Import CSV and the username menu. Tables may need horizontal scrolling to expose their action columns.'],
        tips: ['Use the username menu’s User Help Guide entry to reopen this guide.', 'Chart and table information icons provide contextual explanations in addition to this manual.'],
        keywords: ['theme', 'dark', 'java', 'earth', 'terminal', 'tokyo', 'mobile', 'phone', 'menu'],
      },
      {
        id: 'password-logout', title: 'Change password or sign out',
        paragraphs: ['Choose Change Password from the username menu. Enter your current password and the new password/confirmation, then wait for the result before signing out.', 'Logout ends the browser’s signed-in session. If a session expires or the application sends you back to Login, sign in again rather than repeatedly trying a data-changing action.'],
        tips: ['Keep your application password separate from broker and database credentials.', 'If you forget the password, contact the instance administrator; the app does not provide an email-based password-reset workflow.'],
        links: [{ label: 'Open change password', to: '/change-password' }],
        keywords: ['password', 'login', 'logout', 'session', 'access', 'forgot'],
      },
    ],
  },
  {
    id: 'troubleshooting', title: 'Troubleshooting and common questions',
    description: 'Start with filters and source records before using destructive correction tools.',
    topics: [
      {
        id: 'missing-trades', title: 'Why are trades or statistics missing?',
        paragraphs: ['First check the selected account, dates, trade status, date filter mode and tag settings. An open trade may be visible in Open Trades / Positions without contributing to headline realized performance.'],
        steps: ['Reset the table’s filters and check the relevant account is active.', 'Inspect Executions for the original fills and confirm the import result.', 'Check whether fills are unmatched or whether the trade is still open.', 'For analytical cards, include Untagged trades or adjust the non-Margin tag subset.', 'Refresh after changes. Recalculate only when the underlying records or stored calculations need it.'],
        keywords: ['missing', 'empty', 'zero', 'blank', 'no data', 'filters'],
      },
      {
        id: 'unexpected-pnl', title: 'Why does P&L differ from the broker or another page?',
        paragraphs: ['Views can differ because of account selection, entry/exit/active-date filtering, open-versus-closed status, Margin exclusions or shared tag settings. Net cash, realized net P&L and estimated open P&L are different measures.'],
        steps: ['Compare exactly the same account, date window and trade status.', 'Verify all opening and closing fills are present and grouped correctly.', 'Check quantity, option multiplier, commission, currency and net-cash signs against the original report.', 'After correcting a fill, recalculate that trade and relevant statistics.', 'Investigate missing fees, corporate actions or currency conversion outside the imported execution data before expecting a full broker-account reconciliation.'],
        warning: 'Do not rebuild an entire account merely to make two differently filtered displays agree.',
        keywords: ['pnl', 'wrong profit', 'discrepancy', 'broker', 'cash', 'reconcile', 'fees'],
      },
      {
        id: 'unexpected-grouping', title: 'Why did fills become the wrong trade?',
        paragraphs: ['Automatic grouping reflects the imported symbols, account, signed quantities and available timestamps. Coarse or missing times, incomplete reports and mixed strategies can make automatic grouping differ from your intended journal structure.'],
        tips: ['Inspect linked executions before changing a trade description.', 'Detach/reassign valid fills, or unmatch a grouping and rebuild it manually.', 'Use manual matching for cases where the broker’s execution data does not describe the intended strategy clearly.', 'Review timestamp-matching settings before combining simultaneous fills across symbols.'],
        keywords: ['wrong trade', 'matching', 'group', 'spread', 'manual', 'timestamp'],
      },
      {
        id: 'unavailable-quotes', title: 'Why is open P&L blank or a quote missing?',
        paragraphs: ['Open P&L depends on a supported instrument and a usable quote. Delayed option data can be unavailable, and symbols need sufficient underlying, expiry, strike and call/put information.', 'A missing quote is not a zero-value quote. Net cash still describes the recorded cash movements, but it is not a substitute for a live market valuation.'],
        tips: ['Check contract metadata against the broker report.', 'Use the broker platform for current marks and trading decisions.', 'Refresh may retry available data, but it does not guarantee an upstream quote will exist.'],
        keywords: ['quote', 'open pnl', 'blank', 'dash', 'delayed', 'market data', 'price'],
      },
      {
        id: 'saving-connection', title: 'Save, connection or display problems',
        paragraphs: ['Wait for the save or import result before navigating away. When an operation fails, check the existing records before retrying; a partial import or completed request can already have changed data.', 'If the backend is unavailable, contact the installation administrator. Reimporting reports or reprocessing trades is not a fix for a server connection problem.', 'The public edition protects data-changing requests with CSRF tokens, which the built-in interface handles automatically. If an Invalid CSRF token error appears, refresh and sign in again before safely retrying. Do not disable authentication or CSRF protection to work around an error.', 'For HTTPS installations, use the configured HTTPS address so secure session cookies can work. Certificate errors, disallowed hostnames and database connection settings must be corrected by the instance operator; do not share passwords or turn off verification merely to bypass them.'],
        tips: ['For unsaved notes, explicitly use Save Journal or the trade-journal save action.', 'If an update is deployed but the interface looks old, refresh the page or hard-refresh the browser.', 'If a popup or clipboard operation is blocked, use the corresponding download or regular navigation option.', 'When reporting a problem, include the page, action, expected result and a redacted error message—not credentials or a full private broker report.'],
        keywords: ['save', 'connection', 'error', 'server', 'refresh', 'cache', 'clipboard', 'support', 'CSRF', 'HTTPS', 'TLS', 'certificate', 'session'],
      },
    ],
  },
  {
    id: 'glossary', title: 'Quick reference glossary',
    description: 'Common terms used in the journal, tables and analysis cards.',
    topics: [
      {
        id: 'glossary-records', title: 'Record and matching terms',
        paragraphs: ['Execution / fill: one recorded BUY or SELL transaction. Trade: a journal grouping of executions. Position: the outstanding quantity of an instrument. Leg: an individual instrument within a multi-leg strategy.', 'Matched: linked to a trade. Unmatched: not linked to a trade. Open: quantity remains outstanding. Closed: the grouping’s positions have been closed. Underlying: the stock, index or future behind a contract. Multiplier: the factor converting a quoted contract price into cash value.'],
        keywords: ['execution', 'trade', 'position', 'leg', 'matched', 'unmatched', 'underlying', 'multiplier'],
      },
      {
        id: 'glossary-results', title: 'P&L, dates and classification terms',
        paragraphs: ['Realized P&L: the recorded result of a closed trade. Open P&L: an estimate based on available marks for an open position. Net cash: the signed cash flow stored on executions. Gross P&L: result before trade commissions. Net P&L: result after the stored trade commissions.', 'Entry date: when a trade opened. Exit date: when it closed. Active date: a date or interval during which it was held. Trade tag: a trade classification used by filters and analytics. Event tag: daily context attached to a journal. Drawdown: decline from a previous cumulative performance peak.'],
        keywords: ['pnl', 'gross', 'net', 'cash', 'realized', 'date', 'drawdown', 'tag'],
      },
    ],
  },
];

export function filterHelpSections(query: string): HelpSection[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return helpSections;
  return helpSections.map(section => ({
    ...section,
    topics: section.topics.filter(topic => {
      const text = [section.title, section.description, topic.title, ...topic.paragraphs,
        ...(topic.steps ?? []), ...(topic.tips ?? []), topic.warning ?? '',
        ...(topic.keywords ?? []), ...(topic.links ?? []).map(link => link.label)].join(' ').toLowerCase();
      return terms.every(term => text.includes(term));
    }),
  })).filter(section => section.topics.length > 0);
}
