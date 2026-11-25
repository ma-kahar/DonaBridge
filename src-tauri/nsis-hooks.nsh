; Dona Bridge — NSIS uninstaller hooks
;
; The uninstaller is also executed (silently, with /UPDATE) when a newer
; version is installed over an older one. Deleting app data there wiped every
; account, CRM contact and WhatsApp session on every update — and in silent
; mode NSIS's MessageBox returns IDOK (= IDYES), so the question was never
; shown. Only ask, and only delete, on a real interactive uninstall.

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
  ${AndIfNot} ${Silent}
    MessageBox MB_YESNO|MB_ICONQUESTION "Do you want to remove all Dona Bridge accounts, chats, and local data?$\r$\n$\r$\nChoose No to keep your data for a future reinstall." IDNO skip_clean
      SetShellVarContext current
      RMDir /r "$APPDATA\com.makahar.donabridge"
      RMDir /r "$LOCALAPPDATA\com.makahar.donabridge"
    skip_clean:
  ${EndIf}
!macroend
