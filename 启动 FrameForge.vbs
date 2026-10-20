Set taskShell = CreateObject("WScript.Shell")
Set taskFiles = CreateObject("Scripting.FileSystemObject")
taskShell.CurrentDirectory = taskFiles.GetParentFolderName(WScript.ScriptFullName)
If taskFiles.FileExists(taskShell.CurrentDirectory & "\release\FrameForge-win32-x64\FrameForge.exe") Then
  taskShell.Run Chr(34) & taskShell.CurrentDirectory & "\release\FrameForge-win32-x64\FrameForge.exe" & Chr(34), 1, False
ElseIf taskFiles.FileExists(taskShell.CurrentDirectory & "\node_modules\electron\dist\electron.exe") And taskFiles.FileExists(taskShell.CurrentDirectory & "\dist\index.html") Then
  taskShell.Environment("Process").Remove "ELECTRON_RUN_AS_NODE"
  taskShell.Run Chr(34) & taskShell.CurrentDirectory & "\node_modules\electron\dist\electron.exe" & Chr(34) & " .", 1, False
Else
  MsgBox "Please run npm install and npm run build first, or open the release folder.", 64, "FrameForge"
End If
