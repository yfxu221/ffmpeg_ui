Set taskShell = CreateObject("WScript.Shell")
Set taskFiles = CreateObject("Scripting.FileSystemObject")
taskShell.CurrentDirectory = taskFiles.GetParentFolderName(WScript.ScriptFullName)
taskShell.Environment("Process").Remove "ELECTRON_RUN_AS_NODE"
latestExecutable = ""
If taskFiles.FileExists(taskShell.CurrentDirectory & "\release\latest.txt") Then
  Set latestPointer = taskFiles.OpenTextFile(taskShell.CurrentDirectory & "\release\latest.txt", 1)
  latestExecutable = taskShell.CurrentDirectory & "\" & Trim(latestPointer.ReadAll)
  latestPointer.Close
End If
If latestExecutable <> "" And taskFiles.FileExists(latestExecutable) Then
  taskShell.Run Chr(34) & latestExecutable & Chr(34), 1, False
ElseIf taskFiles.FileExists(taskShell.CurrentDirectory & "\release\FrameForge-win32-x64\FrameForge.exe") Then
  taskShell.Run Chr(34) & taskShell.CurrentDirectory & "\release\FrameForge-win32-x64\FrameForge.exe" & Chr(34), 1, False
ElseIf taskFiles.FileExists(taskShell.CurrentDirectory & "\node_modules\electron\dist\electron.exe") And taskFiles.FileExists(taskShell.CurrentDirectory & "\dist\index.html") Then
  taskShell.Environment("Process").Remove "ELECTRON_RUN_AS_NODE"
  taskShell.Run Chr(34) & taskShell.CurrentDirectory & "\node_modules\electron\dist\electron.exe" & Chr(34) & " .", 1, False
Else
  MsgBox "Please run npm install and npm run build first, or open the release folder.", 64, "FrameForge"
End If
