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
    lastModified（最近修改）优先取 front matter 的 updated，其次取 Git 最后一次
    提交时间（可用 -NoGit 关闭），最后回退到旧索引或文件修改时间。
    可选的 icon 字段（例如 `icon: 🚀`）会写入索引，作为该篇笔记的图标。

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts/build-manifest.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts/build-manifest.ps1 -NoGit
#>
param(
    [string]$Root = '',
    [string]$Output = 'manifest.json',
    [string[]]$ExcludeDirs = @('assets', 'scripts', 'node_modules', '.github', '_site', '.jekyll-cache'),
    [string[]]$ExcludeFiles = @('README.md', 'README.en.md', 'USAGE.md', 'AGENTS.md'),
    [switch]$NoGit
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

function ConvertTo-TagList {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return @() }
    $clean = $Value.Trim()
    if ($clean -match '^\[(.*)\]$') { $clean = $Matches[1] }
    $tags = @()
    foreach ($part in ($clean -split ',')) {
        $tag = $part.Trim().Trim('"').Trim("'")
        if (-not [string]::IsNullOrWhiteSpace($tag)) { $tags += $tag }
    }
    return $tags
}

# 读取旧索引中的日期 / 图标，避免每次重建都把「最近更新」刷新成今天
$previous = @{}
if (Test-Path -LiteralPath $Output) {
    try {
        $old = Get-Content -LiteralPath $Output -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($item in @($old.files)) {
            if ($item -and $item.path) {
                $previous[[string]$item.path] = [pscustomobject]@{
                    date         = [string]$item.date
                    lastModified = [string]$item.lastModified
                    icon         = [string]$item.icon
                }
            }
        }
    }
    catch { }
}

# Git 可用时，用最后一次提交时间作为「最近修改」的可靠来源。
$gitExe = ''
if (-not $NoGit) {
    $gitCmd = Get-Command git -ErrorAction SilentlyContinue
    if ($gitCmd) { $gitExe = $gitCmd.Source }
}

function Get-GitDate {
    param([string]$RelativePath)
    if ([string]::IsNullOrWhiteSpace($gitExe)) { return '' }
    $global:LASTEXITCODE = 0
    try {
        $iso = & $gitExe -C $Root log -1 --format=%cI -- $RelativePath 2>$null
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($iso)) { return '' }
        $iso = ([string]$iso).Trim()
        try {
            return ([datetimeoffset]::Parse($iso, [System.Globalization.CultureInfo]::InvariantCulture)).ToString('yyyy-MM-dd')
        }
        catch { return '' }
    }
    catch { return '' }
}

$utf8 = New-Object System.Text.UTF8Encoding($false)
$files = New-Object System.Collections.ArrayList

foreach ($file in (Get-ChildItem -LiteralPath $Root -Recurse -File -Filter *.md)) {
    $rel = $file.FullName.Substring($Root.Length).TrimStart([char[]]@('\', '/'))
    $rel = $rel.Replace('\', '/')

    # 英文译文由 translate-notes.py 单独维护，不进入中文索引
    if ($file.Name -match '\.en\.md$') { continue }

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
    if ([string]::IsNullOrWhiteSpace($date) -and $previous.ContainsKey($rel)) { $date = $previous[$rel].date }
    if ([string]::IsNullOrWhiteSpace($date)) { $date = $file.LastWriteTime.ToString('yyyy-MM-dd') }

    $lastModified = ''
    if ($frontMatter.ContainsKey('updated')) { $lastModified = [string]$frontMatter['updated'] }
    if ([string]::IsNullOrWhiteSpace($lastModified) -and $frontMatter.ContainsKey('lastModified')) { $lastModified = [string]$frontMatter['lastModified'] }
    if ([string]::IsNullOrWhiteSpace($lastModified)) { $lastModified = Get-GitDate $rel }
    if ([string]::IsNullOrWhiteSpace($lastModified) -and $previous.ContainsKey($rel)) { $lastModified = $previous[$rel].lastModified }
    if ([string]::IsNullOrWhiteSpace($lastModified)) { $lastModified = $file.LastWriteTime.ToString('yyyy-MM-dd') }

    $icon = ''
    if ($frontMatter.ContainsKey('icon')) { $icon = [string]$frontMatter['icon'] }
    if ([string]::IsNullOrWhiteSpace($icon) -and $previous.ContainsKey($rel)) { $icon = $previous[$rel].icon }

    $tags = @()
    if ($frontMatter.ContainsKey('tags')) { $tags = ConvertTo-TagList ([string]$frontMatter['tags']) }

    $null = $files.Add([pscustomobject][ordered]@{
        path         = $rel
        title        = $title.Trim()
        date         = $date.Trim()
        lastModified = $lastModified.Trim()
        icon         = $icon.Trim()
        tags         = @($tags)
        size         = $file.Length
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
