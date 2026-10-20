<#
.SYNOPSIS
    按「学习方向/内容/细节.md」的约定新建一篇笔记，并刷新 manifest.json。

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts/new-note.ps1 -Direction 前端 -Topic JavaScript -Name 变量与类型

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts/new-note.ps1 -Direction 数据库 -Topic MySQL -Name 索引原理 -Force
#>
param(
    [Parameter(Mandatory = $true)][string]$Direction,
    [Parameter(Mandatory = $true)][string]$Topic,
    [Parameter(Mandatory = $true)][string]$Name,
    [string]$Root = '',
    [switch]$Force,
    [switch]$NoManifest
)

$ErrorActionPreference = 'Stop'

# $PSScriptRoot 在参数默认值中求值时可能为空，这里统一兜底
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = Split-Path -Parent $PSScriptRoot }

if (-not (Test-Path -LiteralPath $Root)) { throw "根目录不存在：$Root" }
$Root = (Resolve-Path -LiteralPath $Root).Path

function ConvertTo-SafeName {
    param([string]$Value, [string]$Label)
    $clean = $Value.Trim()
    $clean = $clean.Replace('/', '-').Replace('\', '-')
    $clean = [regex]::Replace($clean, '[<>:"|?*]', '-')
    $clean = [regex]::Replace($clean, '[\x00-\x1f]', '')
    $clean = $clean.Trim().TrimEnd('.')
    if ([string]::IsNullOrWhiteSpace($clean) -or $clean -eq '.' -or $clean -eq '..') {
        throw "$Label 不能为空，也不能包含非法字符。"
    }
    return $clean
}

$dirName = ConvertTo-SafeName -Value $Direction -Label '学习方向'
$topicName = ConvertTo-SafeName -Value $Topic -Label '内容'
$noteName = ConvertTo-SafeName -Value $Name -Label '细节'
if ($noteName -notmatch '\.md$') { $noteName = $noteName + '.md' }

$dir = Join-Path (Join-Path $Root $dirName) $topicName
$target = Join-Path $dir $noteName

if ((Test-Path -LiteralPath $target) -and -not $Force) {
    Write-Host "文件已存在：$target" -ForegroundColor Yellow
    Write-Host '如需覆盖，请加 -Force' -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path -LiteralPath $dir)) {
    $null = New-Item -ItemType Directory -Path $dir -Force
}

$title = [System.IO.Path]::GetFileNameWithoutExtension($noteName)
$title = [regex]::Replace($title, '^\d+[\s._\-、]+', '')
$today = (Get-Date).ToString('yyyy-MM-dd')

$content = @"
---
title: $title
date: $today
tags: [$topicName]
---

# $title

> [!NOTE]
> 这里是 $dirName / $topicName 下的学习笔记，写完记得刷新 manifest.json。

## 要点

- 

## 示例

``````js
// 代码示例
``````

## 参考

- 
"@

$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $content, $utf8)

$relative = $target.Substring($Root.Length).TrimStart('\', '/').Replace('\', '/')
Write-Host "已创建：$relative" -ForegroundColor Green

if (-not $NoManifest) {
    $builder = Join-Path $PSScriptRoot 'build-manifest.ps1'
    if (Test-Path -LiteralPath $builder) {
        & $builder -Root $Root
    }
}

Write-Host '提示：本地预览运行 powershell -ExecutionPolicy Bypass -File scripts/serve.ps1' -ForegroundColor DarkGray
