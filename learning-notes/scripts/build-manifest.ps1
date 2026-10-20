<#
.SYNOPSIS
    扫描仓库中的 Markdown 笔记，生成前端使用的 manifest.json。

.DESCRIPTION
    目录约定：学习方向/内容/细节.md
    每篇笔记可以用 YAML front matter 提供标题和日期：

        ---
        title: 变量与类型
        date: 2026-10-21
        tags: [JavaScript, 基础]
        ---

    没有 front matter 时：标题取第一个 # 标题（再退化为文件名），
    日期优先沿用旧 manifest.json 中的日期，其次使用文件修改时间。

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts/build-manifest.ps1
#>
param(
    [string]$Root = '',
    [string]$Output = 'manifest.json',
    [string[]]$ExcludeDirs = @('assets', 'scripts', 'node_modules', '.github'),
    [string[]]$ExcludeFiles = @('README.md')
)

$ErrorActionPreference = 'Stop'

# $PSScriptRoot 在参数默认值中求值时可能为空，这里统一兜底
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = Split-Path -Parent $PSScriptRoot }

if (-not (Test-Path -LiteralPath $Root)) { throw "根目录不存在：$Root" }
$Root = (Resolve-Path -LiteralPath $Root).Path
if (-not [System.IO.Path]::IsPathRooted($Output)) { $Output = Join-Path $Root $Output }

function Get-FrontMatter {
    param([string]$Text)
    $data = @{}
    $lines = $Text -split "\r?\n"
    if ($lines.Count -lt 2) { return $data }
    if ($lines[0].Trim() -ne '---') { return $data }

    for ($i = 1; $i -lt $lines.Count; $i++) {
        if ($lines[$i].Trim() -eq '---') { break }
        $m = [regex]::Match($lines[$i], '^\s*([A-Za-z0-9_\-]+)\s*:\s*(.*)$')
        if ($m.Success) {
            $data[$m.Groups[1].Value] = $m.Groups[2].Value.Trim().Trim('"').Trim("'")
        }
    }
    return $data
}

function Get-FirstHeading {
    param([string]$Text)
    foreach ($line in ($Text -split "\r?\n")) {
        $m = [regex]::Match($line, '^#\s+(.+)$')
        if ($m.Success) { return $m.Groups[1].Value.Trim() }
    }
    return ''
}

# 读取旧索引中的日期，避免每次重建都把「最近更新」刷新成今天
$previousDates = @{}
if (Test-Path -LiteralPath $Output) {
    try {
        $old = Get-Content -LiteralPath $Output -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($item in @($old.files)) {
            if ($item -and $item.path -and $item.date) { $previousDates[[string]$item.path] = [string]$item.date }
        }
    }
    catch { }
}

$utf8 = New-Object System.Text.UTF8Encoding($false)
$files = New-Object System.Collections.ArrayList

foreach ($file in (Get-ChildItem -LiteralPath $Root -Recurse -File -Filter *.md)) {
    $rel = $file.FullName.Substring($Root.Length).TrimStart('\', '/')
    $rel = $rel.Replace('\', '/')

    $skip = $false
    foreach ($segment in $rel.Split('/')) {
        if ($segment.StartsWith('.')) { $skip = $true }
    }
    if ($ExcludeFiles -contains $rel) { $skip = $true }
    foreach ($dir in $ExcludeDirs) {
        if ($rel -eq $dir -or $rel.StartsWith($dir + '/')) { $skip = $true }
    }
    if ($skip) { continue }

    $text = ''
    try { $text = [System.IO.File]::ReadAllText($file.FullName, [System.Text.Encoding]::UTF8) } catch { }

    $frontMatter = Get-FrontMatter $text
    $title = ''
    if ($frontMatter.ContainsKey('title')) { $title = [string]$frontMatter['title'] }
    if ([string]::IsNullOrWhiteSpace($title)) { $title = Get-FirstHeading $text }
    if ([string]::IsNullOrWhiteSpace($title)) { $title = [System.IO.Path]::GetFileNameWithoutExtension($file.Name) }

    $date = ''
    if ($frontMatter.ContainsKey('date')) { $date = [string]$frontMatter['date'] }
    if ([string]::IsNullOrWhiteSpace($date) -and $previousDates.ContainsKey($rel)) { $date = $previousDates[$rel] }
    if ([string]::IsNullOrWhiteSpace($date)) { $date = $file.LastWriteTime.ToString('yyyy-MM-dd') }

    $null = $files.Add([pscustomobject][ordered]@{
        path  = $rel
        title = $title.Trim()
        date  = $date.Trim()
        size  = $file.Length
    })
}

$sorted = @($files | Sort-Object -Property path)
$manifest = [ordered]@{
    generatedAt = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz')
    count       = $sorted.Count
    files       = $sorted
}

$json = $manifest | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($Output, $json, $utf8)

Write-Host ("已生成 {0}" -f $Output) -ForegroundColor Green
Write-Host ("共 {0} 篇笔记" -f $sorted.Count) -ForegroundColor DarkGray
