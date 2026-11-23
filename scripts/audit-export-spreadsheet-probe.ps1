param(
  [Parameter(Mandatory = $true)][string]$CsvPath,
  [Parameter(Mandatory = $true)][string]$ReportPath,
  [ValidateSet('PowerQuery', 'OpenTextGeneral')][string]$ImportMode = 'PowerQuery'
)

$ErrorActionPreference = 'Stop'
$sourcePath = (Resolve-Path -LiteralPath $CsvPath).Path
$reportTarget = [IO.Path]::GetFullPath($ReportPath)
$evidenceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../.local/evidence/imp-06/audit-export-spreadsheet')) + [IO.Path]::DirectorySeparatorChar
if (-not $sourcePath.StartsWith($evidenceRoot, [StringComparison]::OrdinalIgnoreCase) -or
    -not $reportTarget.StartsWith($evidenceRoot, [StringComparison]::OrdinalIgnoreCase) -or
    [IO.Path]::GetFileName($sourcePath) -ne 'benign.csv') {
  throw 'Only the private, generated spreadsheet fixture can be imported.'
}
if (Test-Path -LiteralPath $reportTarget) { throw 'An existing probe report cannot be overwritten.' }

function Release-ComObject($value) {
  if ($null -ne $value -and [Runtime.InteropServices.Marshal]::IsComObject($value)) {
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($value)
  }
}

$excel = $null
$workbooks = $null
$workbook = $null
$sheets = $null
$sheet = $null
$queries = $null
$query = $null
$queryTables = $null
$queryTable = $null
$destination = $null
$used = $null
$rows = $null
$columns = $null
$cells = $null
$failure = $null
$sourceHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
$result = [ordered]@{
  status = 'failed'
  application = 'Microsoft Excel'
  import = $ImportMode
  sourceSha256 = $sourceHash
  savedChanges = $false
  sources = @(
    'https://learn.microsoft.com/en-us/office/vba/api/excel.queries.add',
    'https://learn.microsoft.com/en-us/powerquery-m/csv-document',
    'https://learn.microsoft.com/en-us/office/vba/api/excel.querytables.add',
    'https://learn.microsoft.com/en-us/office/vba/api/excel.querytable.refresh',
    'https://learn.microsoft.com/en-us/office/vba/api/excel.workbooks.opentext'
  )
}

try {
  # Use a new Excel instance and an unsaved, empty workbook. Never attach to an
  # existing user session. The only external source is the generated local CSV.
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.AskToUpdateLinks = $false
  $excel.AutomationSecurity = 3
  $excel.EnableEvents = $false
  $result.version = [string]$excel.Version
  $result.build = [string]$excel.Build
  $workbooks = $excel.Workbooks
  if ($ImportMode -eq 'OpenTextGeneral') {
    # UTF-8, delimited, double-quote qualifier, comma delimiter. Omit FieldInfo
    # so Excel applies General parsing; this is the formula-neutralization probe.
    $workbooks.OpenText($sourcePath, 65001, 1, 1, 1, $false, $false, $false, $true)
    $workbook = $excel.ActiveWorkbook
    $sheets = $workbook.Worksheets
    $sheet = $sheets.Item(1)
    $result.purpose = 'Formula neutralization in the legacy General importer; not CSV multiline fidelity'
  } else {
    $workbook = $workbooks.Add()
    $sheets = $workbook.Worksheets
    $sheet = $sheets.Item(1)
    $queries = $workbook.Queries

    # The official Power Query parser supports quoted line breaks. Infer column
    # count; do not truncate columns or change CSV bytes/values/types. Its default
    # text results prove fidelity, not automatic formula-neutralization behavior.
    $mPath = $sourcePath.Replace('"', '""')
    $formula = 'let Source = Csv.Document(File.Contents("' + $mPath + '"), [Delimiter=",", Encoding=65001, CsvStyle=CsvStyle.QuoteAfterDelimiter, QuoteStyle=QuoteStyle.Csv]) in Table.PromoteHeaders(Source, [PromoteAllScalars=true])'
    $query = $queries.Add('AuditExportProbe', $formula)
    $queryTables = $sheet.QueryTables
    $destination = $sheet.Range('A1')
    $queryTable = $queryTables.Add('OLEDB;Provider=Microsoft.Mashup.OleDb.1;Data Source=$Workbook$;Location=AuditExportProbe;Extended Properties=""', $destination)
    $queryTable.CommandType = 2 # xlCmdSql
    $queryTable.CommandText = 'SELECT * FROM [AuditExportProbe]'
    $queryTable.RefreshOnFileOpen = $false
    $queryTable.FillAdjacentFormulas = $false
    $queryTable.BackgroundQuery = $false
    if (-not $queryTable.Refresh($false)) { throw 'CSV_IMPORT_CANCELLED' }
    $result.purpose = 'CSV fidelity using Csv.Document UTF-8/comma/QuoteStyle.Csv, default text results'
  }

  $used = $sheet.UsedRange
  $rows = $used.Rows
  $columns = $used.Columns
  $rowCount = $rows.Count
  $columnCount = $columns.Count
  $result.rows = $rowCount
  $result.columns = $columnCount
  $values = $used.Value2
  if ($columnCount -ne 8 -or ($ImportMode -eq 'PowerQuery' -and $rowCount -ne 15) -or $rowCount -lt 12) {
    $result.importedValues = $values
    throw 'CSV_IMPORT_DIMENSIONS'
  }
  $headers = @('event_id', 'occurred_at', 'actor_id', 'action', 'entity_type', 'entity_id', 'organization_id', 'outcome')
  for ($c = 1; $c -le 8; $c++) {
    if ([string]$values[1, $c] -cne $headers[$c - 1]) { throw 'CSV_HEADERS' }
  }
  $cells = $sheet.Cells
  $formulaCount = 0
  $literalCount = 0
  $literalExpected = @(
    'texto: =1+1', 'texto: +1+1', 'texto: -1+1', 'texto: @SUM(1)',
    'texto: ＝1', 'texto: ＋1', 'texto: －1', 'texto: ＠1',
    'texto:  \u0009=1', 'texto: \u200b=1', 'texto: \ufeff+1'
  )
  for ($r = 2; $r -le $rowCount; $r++) {
    for ($c = 1; $c -le 8; $c++) {
      $cell = $null
      try {
        $cell = $cells.Item($r, $c)
        if ($cell.HasFormula) { $formulaCount++ }
      } finally { Release-ComObject $cell }
    }
    $value = [string]$values[$r, 4]
    if ($r -le 12) {
      if ($value.StartsWith('texto: ')) { $literalCount++ }
      if ($value -cne $literalExpected[$r - 2]) { throw 'CSV_FORMULA_LITERAL_CHANGED' }
    }
    if ($ImportMode -eq 'PowerQuery') {
      if ([string]$values[$r, 3] -ne '' -or [string]$values[$r, 6] -ne '') { throw 'CSV_NULL_FIELDS' }
      if ([string]$values[$r, 2] -cne '2026-11-02T00:00:00.123456Z') { throw 'CSV_TIMESTAMP_PRECISION' }
    }
  }
  $result.formulas = $formulaCount
  $result.literalFormulaLikeCells = $literalCount
  if ($formulaCount -ne 0 -or $literalCount -ne 11) { throw 'CSV_FORMULA_NOT_LITERAL' }
  if ($ImportMode -eq 'PowerQuery') {
    if ([string]$values[13, 4] -cne 'acción,"uno"') { throw 'CSV_UNICODE_QUOTES' }
    if ([string]$values[14, 4] -cne "línea1`nlinea2" -and [string]$values[14, 4] -cne "línea1`r`nlinea2") { throw 'CSV_MULTILINE' }
    if ([string]$values[15, 4] -cne 'control\u0000fin') { throw 'CSV_CONTROL_ESCAPE' }
    $result.multilinePreserved = $true
  } else {
    $result.multilinePreserved = ($rowCount -eq 15 -and ([string]$values[14, 4] -ceq "línea1`nlinea2" -or [string]$values[14, 4] -ceq "línea1`r`nlinea2"))
    $result.importedValues = $values
  }
  $result.status = 'passed'
} catch {
  $failure = $_
  $result.error = $_.Exception.Message
} finally {
  try {
    foreach ($value in @($cells, $columns, $rows, $used, $queryTable, $destination, $queryTables, $query, $queries, $sheet, $sheets)) {
      Release-ComObject $value
    }
  } finally {
    try {
      if ($null -ne $workbook) { $workbook.Close($false) }
    } finally {
      try {
        Release-ComObject $workbook
        Release-ComObject $workbooks
      } finally {
        try {
          if ($null -ne $excel) { $excel.Quit() }
        } finally {
          try {
            Release-ComObject $excel
            # OpenText locks its CSV until Close/Quit. Verify unchanged bytes
            # after disposal, while the report still records any failure.
            if ((Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $sourceHash) { throw 'CSV_SOURCE_CHANGED' }
          } catch {
            if ($null -eq $failure) { $failure = $_ }
            $result.status = 'failed'
            $result.error = $_.Exception.Message
          } finally {
            [IO.File]::WriteAllText($reportTarget, ($result | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
          }
        }
      }
    }
  }
}
if ($null -ne $failure) { throw $failure }
