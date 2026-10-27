' 启动 DSH 发现中继，不带控制台窗口。
' 用法：wscript.exe //nologo run-discovery-relay.vbs ["<node.exe 的完整路径>"]
'
' 计划任务原先直接运行 node.exe，登录时会弹出一个控制台窗口。这里改用
' WScript.Shell.Run 的 0 窗口模式启动，并把输出写入 discovery-relay.log。
Option Explicit

Dim fso, shell, here, relayPath, logPath, nodePath, command, style

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

here = fso.GetParentFolderName(WScript.ScriptFullName)
relayPath = fso.BuildPath(here, "discovery-relay.mjs")
logPath = fso.BuildPath(here, "discovery-relay.log")

nodePath = "node.exe"
If WScript.Arguments.Count > 0 Then
    If fso.FileExists(WScript.Arguments(0)) Then
        nodePath = WScript.Arguments(0)
    End If
End If

If Not fso.FileExists(relayPath) Then
    WScript.Quit 1
End If

' 0 = 隐藏窗口，False = 不等待子进程退出
command = """" & nodePath & """ """ & relayPath & """ --log """ & logPath & """"
shell.Run command, 0, False
