$ErrorActionPreference = 'Stop'

$supportedModes = @('--offline-check', '--verify-only', '--execute')
$requestedModes = @($args | Where-Object { $_ -like '--*' })
if ($requestedModes.Count -gt 1 -or ($requestedModes.Count -eq 1 -and $requestedModes[0] -notin $supportedModes)) {
  Write-Output '{"stage":"mode_check","success":false,"message":"Use --offline-check, --verify-only, or --execute"}'
  exit 2
}
$scriptMode = if ($requestedModes.Count -eq 1) { $requestedModes[0] } else { '--offline-check' }

if ($scriptMode -eq '--offline-check') {
  & node (Join-Path $PSScriptRoot 'ainote-clean-return-poc.mjs') $scriptMode
  exit $LASTEXITCODE
}

if ($scriptMode -eq '--execute') {
  $helperPath = $env:AINOTE_API_HELPER
  if ([string]::IsNullOrWhiteSpace($helperPath) -or
      [System.IO.Path]::GetFileName($helperPath) -ine 'ainote_api.py' -or
      -not (Test-Path -LiteralPath $helperPath -PathType Leaf)) {
    Write-Output '{"stage":"helper_check","success":false,"message":"AINOTE_API_HELPER must point to an externally supplied readable ainote_api.py file; the helper is not bundled"}'
    exit 3
  }
}

$credentialTarget = $env:AINOTE_NOTION_CREDENTIAL_TARGET
if ([string]::IsNullOrWhiteSpace($credentialTarget)) {
  Write-Output '{"stage":"credential_config","success":false,"message":"AINOTE_NOTION_CREDENTIAL_TARGET is required for network modes"}'
  exit 4
}

$source = @'
using System;
using System.Runtime.InteropServices;

public static class NativeCredentialReaderForExperimentalAinoteReturn {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct CREDENTIAL {
    public UInt32 Flags; public UInt32 Type; public IntPtr TargetName; public IntPtr Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize; public IntPtr CredentialBlob; public UInt32 Persist;
    public UInt32 AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName;
  }
  [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredRead(string target, uint type, int reservedFlag, out IntPtr credentialPtr);
  [DllImport("advapi32.dll", SetLastError = true)] private static extern void CredFree(IntPtr buffer);
  public static string ReadGenericSecret(string target) {
    IntPtr pointer;
    if (!CredRead(target, 1, 0, out pointer)) return null;
    try {
      CREDENTIAL credential = Marshal.PtrToStructure<CREDENTIAL>(pointer);
      if (credential.CredentialBlob == IntPtr.Zero || credential.CredentialBlobSize == 0) return null;
      return Marshal.PtrToStringUni(credential.CredentialBlob, checked((int)credential.CredentialBlobSize / 2));
    }
    finally { CredFree(pointer); }
  }
}
'@

Add-Type -TypeDefinition $source
$secret = [NativeCredentialReaderForExperimentalAinoteReturn]::ReadGenericSecret($credentialTarget)
if ([string]::IsNullOrWhiteSpace($secret)) {
  Write-Output '{"stage":"credential_check","success":false,"message":"Configured Notion credential is missing"}'
  exit 5
}

$pythonExecutable = $null
if ($scriptMode -eq '--execute') {
  $pythonCommand = @(Get-Command python -All -CommandType Application -ErrorAction SilentlyContinue |
    Where-Object { $_.Source -and $_.Source -notlike '*\WindowsApps\*' }) | Select-Object -First 1
  if ($null -eq $pythonCommand -or [string]::IsNullOrWhiteSpace($pythonCommand.Source)) {
    Write-Output '{"stage":"python_check","success":false,"message":"A real Python executable is unavailable"}'
    exit 6
  }
  $pythonExecutable = $pythonCommand.Source
}

try {
  $env:NOTION_API_KEY = $secret
  $env:AINOTE_RETURN_NOTION_TOKEN_SOURCE = 'WindowsCredentialManager'
  if ($null -ne $pythonExecutable) { $env:AINOTE_PYTHON = $pythonExecutable }
  $env:PYTHONIOENCODING = 'utf-8'
  & node (Join-Path $PSScriptRoot 'ainote-clean-return-poc.mjs') $scriptMode
  exit $LASTEXITCODE
}
finally {
  $secret = $null
  $pythonExecutable = $null
  Remove-Item Env:NOTION_API_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:AINOTE_RETURN_NOTION_TOKEN_SOURCE -ErrorAction SilentlyContinue
  Remove-Item Env:AINOTE_PYTHON -ErrorAction SilentlyContinue
  Remove-Item Env:PYTHONIOENCODING -ErrorAction SilentlyContinue
}
