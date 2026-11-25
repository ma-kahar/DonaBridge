!macro NSIS_HOOK_POSTUNINSTALL
  MessageBox MB_YESNO "Do you want to remove all Dona Bridge accounts, chats, and local data?" IDNO skip_clean
    RMDir /r "$APPDATA\com.makahar.donabridge"
    RMDir /r "$LOCALAPPDATA\com.makahar.donabridge"
  skip_clean:
!macroend
