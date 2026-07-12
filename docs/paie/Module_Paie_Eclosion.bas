Attribute VB_Name = "Module_Paie_Eclosion"
Option Explicit

Public Const MOT_DE_PASSE_ADMIN As String = "ECL2026"

'====================================================================
' DEVERROUILLERTOUT / VERROUILLERTOUT
'====================================================================
Sub DeverrouillerTout()
    Dim ws As Worksheet
    For Each ws In ThisWorkbook.Worksheets
        On Error Resume Next
        ws.Unprotect Password:=MOT_DE_PASSE_ADMIN
        On Error GoTo 0
    Next ws
    MsgBox "Toutes les feuilles sont déverrouillées.", vbInformation, "Éclosion"
End Sub

Sub VerrouillerTout()
    Dim ws As Worksheet
    For Each ws In ThisWorkbook.Worksheets
        On Error Resume Next
        ws.Protect Password:=MOT_DE_PASSE_ADMIN, DrawingObjects:=True, _
            Contents:=True, Scenarios:=True, AllowFiltering:=True, AllowSorting:=True
        On Error GoTo 0
    Next ws
    MsgBox "Toutes les feuilles sont verrouillées.", vbInformation, "Éclosion"
End Sub

'====================================================================
' GENERERBULLETINSPDF
' Boucle sur les employés Actifs, change Bulletin!B3, force le recalcul
' (Application.Calculate + DoEvents), exporte un PDF par salarié.
'====================================================================
Sub GenererBulletinsPDF()
    Dim wsEmp As Worksheet, wsBul As Worksheet
    Dim i As Long, lastRow As Long, nbGeneres As Long
    Dim matricule As String, nom As String
    Dim dossier As String, cheminPDF As String

    Set wsEmp = ThisWorkbook.Worksheets("Employés")
    Set wsBul = ThisWorkbook.Worksheets("Bulletin")

    dossier = ThisWorkbook.Path & Application.PathSeparator & _
        "Bulletins_" & Format(Range("PERIODE_DATE").Value, "yyyy-mm") & Application.PathSeparator
    If Dir(dossier, vbDirectory) = "" Then MkDir dossier

    lastRow = wsEmp.Cells(wsEmp.Rows.Count, "A").End(xlUp).Row
    nbGeneres = 0

    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationAutomatic

    For i = 5 To lastRow
        matricule = wsEmp.Cells(i, "A").Value
        If matricule <> "" And wsEmp.Cells(i, "N").Value = "Actif" Then
            nom = wsEmp.Cells(i, "B").Value

            ' --- Étape critique : changer le matricule PUIS forcer le recalcul
            '     avant l'export. C'est l'absence de ces 2 lignes qui provoque
            '     des PDF identiques pour chaque salarié. ---
            wsBul.Range("B3").Value = matricule
            Application.Calculate
            DoEvents

            cheminPDF = dossier & matricule & "_" & _
                Application.WorksheetFunction.Substitute(nom, " ", "_") & ".pdf"

            wsBul.ExportAsFixedFormat Type:=xlTypePDF, Filename:=cheminPDF, _
                Quality:=xlQualityStandard, IncludeDocProperties:=True, _
                IgnorePrintAreas:=False, OpenAfterPublish:=False

            nbGeneres = nbGeneres + 1
        End If
    Next i

    Application.ScreenUpdating = True
    MsgBox nbGeneres & " bulletin(s) généré(s) dans :" & vbCrLf & dossier, vbInformation, "Éclosion"
End Sub

'====================================================================
' ENVOYERBULLETINSPARMAIL
' Même principe que GenererBulletinsPDF, + envoi Outlook par salarié.
'====================================================================
Sub EnvoyerBulletinsParEmail()
    Dim wsEmp As Worksheet, wsBul As Worksheet
    Dim OutApp As Object, OutMail As Object
    Dim i As Long, lastRow As Long, nbEnvoyes As Long
    Dim matricule As String, nom As String, email As String
    Dim dossier As String, cheminPDF As String

    Set wsEmp = ThisWorkbook.Worksheets("Employés")
    Set wsBul = ThisWorkbook.Worksheets("Bulletin")

    dossier = ThisWorkbook.Path & Application.PathSeparator & _
        "Bulletins_" & Format(Range("PERIODE_DATE").Value, "yyyy-mm") & Application.PathSeparator
    If Dir(dossier, vbDirectory) = "" Then MkDir dossier

    On Error Resume Next
    Set OutApp = CreateObject("Outlook.Application")
    On Error GoTo 0
    If OutApp Is Nothing Then
        MsgBox "Outlook n'est pas disponible sur ce poste. Envoi impossible.", vbCritical, "Éclosion"
        Exit Sub
    End If

    lastRow = wsEmp.Cells(wsEmp.Rows.Count, "A").End(xlUp).Row
    nbEnvoyes = 0

    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationAutomatic

    For i = 5 To lastRow
        matricule = wsEmp.Cells(i, "A").Value
        If matricule <> "" And wsEmp.Cells(i, "N").Value = "Actif" Then
            nom = wsEmp.Cells(i, "B").Value
            email = wsEmp.Cells(i, "H").Value

            If email <> "" Then
                wsBul.Range("B3").Value = matricule
                Application.Calculate
                DoEvents

                cheminPDF = dossier & matricule & "_" & _
                    Application.WorksheetFunction.Substitute(nom, " ", "_") & ".pdf"

                wsBul.ExportAsFixedFormat Type:=xlTypePDF, Filename:=cheminPDF, _
                    Quality:=xlQualityStandard, IncludeDocProperties:=True, _
                    IgnorePrintAreas:=False, OpenAfterPublish:=False

                Set OutMail = OutApp.CreateItem(0)
                With OutMail
                    .To = email
                    .Subject = "Bulletin de paie – " & Range("PERIODE_LIBELLE").Value
                    .Body = "Bonjour " & nom & "," & vbCrLf & vbCrLf & _
                        "Veuillez trouver ci-joint votre bulletin de paie pour la période " & _
                        Range("PERIODE_LIBELLE").Value & "." & vbCrLf & vbCrLf & _
                        "Cordialement," & vbCrLf & "Éditions Éclosion"
                    .Attachments.Add cheminPDF
                    .Send
                End With
                Set OutMail = Nothing
                nbEnvoyes = nbEnvoyes + 1
            End If
        End If
    Next i

    Application.ScreenUpdating = True
    MsgBox nbEnvoyes & " bulletin(s) envoyé(s) par email.", vbInformation, "Éclosion"
End Sub

'====================================================================
' CLOTURERMOIS
' Archive chaque ligne active du "Livre de paie" vers "Journal de paie".
' Anti-doublon : vérifie si la période existe déjà dans le Journal.
' Mapping colonnes (voir Guide Développeur) :
'   Journal B..T  = Livre A..S   (décalage de 1 colonne)
'   Journal U     = Livre U      (IRPP+CAC)
'   Journal V     = Livre Z      (Total retenues internes)
'   Journal W     = Livre AA     (Total retenues salariales)
'   Journal X     = Livre AB     (Total charges patronales)
'   Journal Y     = Livre AC     (NET À PAYER)
'   Journal Z     = Livre AD     (Coût employeur)
'   Journal A     = période (nouvelle colonne)
'   Journal AA    = date de clôture (horodatage)
'====================================================================
Sub CloturerMois()
    Dim wsLivre As Worksheet, wsJournal As Worksheet
    Dim i As Long, lastRowLivre As Long, ligneJournal As Long
    Dim periode As Date
    Dim matricule As String
    Dim nbDoublons As Long, nbArchives As Long
    Dim colLivre As Long

    Set wsLivre = ThisWorkbook.Worksheets("Livre de paie")
    Set wsJournal = ThisWorkbook.Worksheets("Journal de paie")
    periode = Range("PERIODE_DATE").Value

    ' --- Anti-doublon ---
    nbDoublons = Application.WorksheetFunction.CountIf(wsJournal.Range("A:A"), periode)
    If nbDoublons > 0 Then
        If MsgBox("La période " & Range("PERIODE_LIBELLE").Value & _
            " a déjà été clôturée (" & nbDoublons & " ligne(s) trouvée(s))." & vbCrLf & _
            "Continuer quand même et créer un doublon ?", vbYesNo + vbExclamation, "Éclosion") = vbNo Then
            Exit Sub
        End If
    End If

    lastRowLivre = wsLivre.Cells(wsLivre.Rows.Count, "A").End(xlUp).Row
    ligneJournal = wsJournal.Cells(wsJournal.Rows.Count, "A").End(xlUp).Row + 1
    nbArchives = 0

    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationAutomatic
    Application.Calculate

    For i = 5 To lastRowLivre
        matricule = wsLivre.Cells(i, "A").Value
        If matricule <> "" Then
            wsJournal.Cells(ligneJournal, 1).Value = periode              ' A: Période
            wsJournal.Cells(ligneJournal, 2).Value = matricule            ' B: Matricule = Livre A

            For colLivre = 2 To 19 ' Livre B..S -> Journal C..T
                wsJournal.Cells(ligneJournal, colLivre + 1).Value = wsLivre.Cells(i, colLivre).Value
            Next colLivre

            wsJournal.Cells(ligneJournal, 21).Value = wsLivre.Cells(i, 21).Value ' U: IRPP+CAC
            wsJournal.Cells(ligneJournal, 22).Value = wsLivre.Cells(i, 26).Value ' V: Tot. ret. internes (Livre Z)
            wsJournal.Cells(ligneJournal, 23).Value = wsLivre.Cells(i, 27).Value ' W: Tot. ret. salariales (Livre AA)
            wsJournal.Cells(ligneJournal, 24).Value = wsLivre.Cells(i, 28).Value ' X: Tot. ch. patronales (Livre AB)
            wsJournal.Cells(ligneJournal, 25).Value = wsLivre.Cells(i, 29).Value ' Y: NET À PAYER (Livre AC)
            wsJournal.Cells(ligneJournal, 26).Value = wsLivre.Cells(i, 30).Value ' Z: Coût employeur (Livre AD)
            wsJournal.Cells(ligneJournal, 27).Value = Now                       ' AA: date de clôture

            ligneJournal = ligneJournal + 1
            nbArchives = nbArchives + 1
        End If
    Next i

    Application.ScreenUpdating = True
    MsgBox "Clôture de " & Range("PERIODE_LIBELLE").Value & " effectuée : " & _
        nbArchives & " salarié(s) archivé(s) dans le Journal de paie.", vbInformation, "Éclosion"
End Sub
