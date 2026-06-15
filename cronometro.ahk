#Requires AutoHotkey v2.0
#SingleInstance Force

; ===================== CONFIGURE AQUI (uma vez) =====================
WORKER_URL := "https://dash-lala-api.ikkysousa5.workers.dev"
VALOR_HORA := 10                          ; R$ por hora
; Usuário e senha são pedidos na 1ª vez e salvos. Trocar a conta: Ctrl+Alt+L
; ===================================================================

global STATE := A_ScriptDir "\cronometro_estado.ini"
global SES := "tables/Sess%C3%B5es%20de%20Trabalho/rows"
global LAN := "tables/Lan%C3%A7amentos/rows"
global TOKEN := ""
global userHidden := false
global isShown := false
global flashText := "", flashColor := "", flashUntil := 0
global WIN_W := 304

; ---- Widget fixo no canto superior direito ----
global WIN := Gui("+AlwaysOnTop -Caption +ToolWindow")
WIN.BackColor := "12151B"
WIN.MarginX := 14, WIN.MarginY := 9
global TXT := WIN.Add("Text", "w280 h30 Center 0x200", "00:00:00")
TXT.SetFont("s14 bold cBBBBBB", "Segoe UI")

SetTimer(Update, 1000)
Update()

; ---- Atalhos globais ----
^!i::Iniciar()    ; Ctrl+Alt+I  -> iniciar
^!p::Pausar()     ; Ctrl+Alt+P  -> pausar (salva o trecho) / voltar
^!r::Registrar()  ; Ctrl+Alt+R  -> fecha o último trecho e zera
^!v::Ver()        ; Ctrl+Alt+V  -> mostrar/esconder
^!l::ReLogin()    ; Ctrl+Alt+L  -> trocar usuário/senha

HHMMSS(s) {
    h := s // 3600, m := Mod(s, 3600) // 60, x := Mod(s, 60)
    return Format("{:02}:{:02}:{:02}", h, m, x)
}
BRL(v) => "R$ " StrReplace(Format("{:.2f}", v), ".", ",")
ISO(s) => SubStr(s,1,4) "-" SubStr(s,5,2) "-" SubStr(s,7,2) "T" SubStr(s,9,2) ":" SubStr(s,11,2) ":" SubStr(s,13,2)
DataDe(s) => SubStr(s,1,4) "-" SubStr(s,5,2) "-" SubStr(s,7,2)

; tempo total já trabalhado (segundos) incluindo o trecho atual
Trabalhado() {
    if (IniRead(STATE, "timer", "ativo", "") = "")
        return -1
    acum := IniRead(STATE, "timer", "acum", 0) + 0
    seg := IniRead(STATE, "timer", "seg", "")
    if (seg != "")
        acum += DateDiff(A_Now, seg, "Seconds")
    return acum
}

ApplyVisibility(show) {
    global isShown, WIN, WIN_W
    if (show && !isShown) {
        WinSetTransparent(0, WIN)
        WIN.Show("x" (A_ScreenWidth - WIN_W - 16) " y16 w" WIN_W " NoActivate")
        a := 0
        loop 10 {
            a += 24
            WinSetTransparent(a > 235 ? 235 : a, WIN)
            Sleep 14
        }
        isShown := true
    } else if (!show && isShown) {
        a := 235
        loop 10 {
            a -= 24
            WinSetTransparent(a < 0 ? 0 : a, WIN)
            Sleep 14
        }
        WIN.Hide()
        isShown := false
    }
}

SetWidget(text, color) {
    if (userHidden) {
        ApplyVisibility(false)
        return
    }
    TXT.SetFont("c" color)
    TXT.Value := text
    ApplyVisibility(true)
}

Update(*) {
    if (flashUntil > A_TickCount && flashText != "") {
        SetWidget(flashText, flashColor)
        return
    }
    total := Trabalhado()
    if (total < 0) {
        SetWidget("00:00:00     " BRL(0), "808890")
        return
    }
    rodando := (IniRead(STATE, "timer", "seg", "") != "")
    ganho := (total / 3600) * VALOR_HORA
    SetWidget((rodando ? "" : "PAUSA  ") HHMMSS(total) "     " BRL(ganho), rodando ? "37B26B" : "FFC107")
}

Flash(text, color, ms := 2500) {
    global flashText, flashColor, flashUntil
    flashText := text, flashColor := color, flashUntil := A_TickCount + ms
    Update()
}

; grava um trecho (uma sessão) e o ganho dele; devolve [status_sessao, status_ganho]
GravarTrecho(ini, fim) {
    secs := DateDiff(fim, ini, "Seconds")
    horas := Round(secs / 3600, 2)
    valor := Round(horas * VALOR_HORA, 2)
    bodyS := '{"rows":[{"Início":"' ISO(ini) '","Fim":"' ISO(fim) '","Duração (h)":' horas ',"Valor/hora":' VALOR_HORA '}]}'
    s1 := PostJSON(SES, bodyS)
    s2 := "—"
    if (valor > 0) {
        bodyL := '{"rows":[{"Data":"' DataDe(fim) '","Descrição":"Trabalho (' horas 'h)","Valor":' valor ',"Tipo":"Entrada","Natureza":"Variada","Status":"Confirmado","Origem":"Cronômetro"}]}'
        s2 := PostJSON(LAN, bodyL)
    }
    return [s1, s2]
}

Iniciar(*) {
    if (IniRead(STATE, "timer", "ativo", "") != "") {
        Flash("já rodando", "FFC107", 1500)
        return
    }
    IniWrite(1, STATE, "timer", "ativo")
    IniWrite(0, STATE, "timer", "acum")
    IniWrite(A_Now, STATE, "timer", "seg")
    Update()
}

Pausar(*) {
    if (IniRead(STATE, "timer", "ativo", "") = "") {
        Flash("nada rodando", "FFC107", 1500)
        return
    }
    seg := IniRead(STATE, "timer", "seg", "")
    if (seg != "") {                                   ; pausar -> fecha e grava o trecho
        secs := DateDiff(A_Now, seg, "Seconds")
        r := GravarTrecho(seg, A_Now)
        IniWrite(IniRead(STATE, "timer", "acum", 0) + secs, STATE, "timer", "acum")
        IniDelete(STATE, "timer", "seg")
        ok := (r[1] = 200 || r[1] = 202)
        Flash(ok ? "trecho salvo · pausa" : "erro  S:" r[1], ok ? "FFC107" : "E5575C", 2500)
    } else {                                            ; voltar -> abre novo trecho
        IniWrite(A_Now, STATE, "timer", "seg")
        Update()
    }
}

Ver(*) {
    global userHidden
    userHidden := !userHidden
    Update()
}

Registrar(*) {
    if (IniRead(STATE, "timer", "ativo", "") = "") {
        Flash("nada p/ registrar", "FFC107", 1500)
        return
    }
    seg := IniRead(STATE, "timer", "seg", "")
    total := IniRead(STATE, "timer", "acum", 0) + 0
    erro := ""
    if (seg != "") {                                   ; fecha o trecho atual
        secs := DateDiff(A_Now, seg, "Seconds")
        r := GravarTrecho(seg, A_Now)
        total += secs
        if !(r[1] = 200 || r[1] = 202)
            erro := "  S:" r[1]
    }
    IniDelete(STATE, "timer", "ativo")
    IniDelete(STATE, "timer", "acum")
    IniDelete(STATE, "timer", "seg")
    horas := Round(total / 3600, 2)
    Flash(erro = "" ? "OK  " horas "h  " BRL(horas * VALOR_HORA) : "erro" erro, erro = "" ? "37B26B" : "E5575C", 5000)
}

Login() {
    global WORKER_URL, TOKEN, STATE
    u := IniRead(STATE, "conta", "usuario", "")
    s := IniRead(STATE, "conta", "senha", "")
    if (u = "" || s = "") {
        if !PedirLogin()
            return ""
        u := IniRead(STATE, "conta", "usuario", "")
        s := IniRead(STATE, "conta", "senha", "")
    }
    try {
        whr := ComObject("WinHttp.WinHttpRequest.5.1")
        whr.Open("POST", RTrim(WORKER_URL, "/") "/login", false)
        whr.SetRequestHeader("Content-Type", "application/json; charset=utf-8")
        body := '{"usuario":"' JsonEsc(u) '","senha":"' JsonEsc(s) '"}'
        st := ComObject("ADODB.Stream")
        st.Type := 2, st.Charset := "UTF-8", st.Open(), st.WriteText(body)
        st.Position := 0, st.Type := 1, st.Position := 3
        whr.Send(st.Read()), st.Close()
        if (whr.Status = 200 && RegExMatch(whr.ResponseText, '"token"\s*:\s*"([^"]+)"', &m))
            TOKEN := m[1]
    } catch as e {
    }
    return TOKEN
}
JsonEsc(x) => StrReplace(StrReplace(x, "\", "\\"), '"', '\"')
PedirLogin() {
    global STATE
    ib := InputBox("Usuário do Dash Lala:", "Dash — Login")
    if (ib.Result != "OK" || ib.Value = "")
        return false
    ib2 := InputBox("Senha:", "Dash — Login", "Password")
    if (ib2.Result != "OK" || ib2.Value = "")
        return false
    IniWrite(ib.Value, STATE, "conta", "usuario")
    IniWrite(ib2.Value, STATE, "conta", "senha")
    return true
}
ReLogin(*) {
    global TOKEN
    if PedirLogin() {
        TOKEN := ""
        Login()
        Flash(TOKEN != "" ? "login ok" : "login falhou", TOKEN != "" ? "37B26B" : "E5575C", 2500)
    }
}
PostJSON(path, body) {
    if (TOKEN = "")
        Login()
    s := SendReq(path, body)
    if (s = 401) {
        Login()
        s := SendReq(path, body)
    }
    return s
}
SendReq(path, body) {
    global WORKER_URL, TOKEN
    try {
        whr := ComObject("WinHttp.WinHttpRequest.5.1")
        whr.Open("POST", RTrim(WORKER_URL, "/") "/" path, false)
        whr.SetRequestHeader("Content-Type", "application/json; charset=utf-8")
        whr.SetRequestHeader("Authorization", "Bearer " TOKEN)
        st := ComObject("ADODB.Stream")
        st.Type := 2, st.Charset := "UTF-8"
        st.Open(), st.WriteText(body)
        st.Position := 0, st.Type := 1, st.Position := 3
        bytes := st.Read()
        st.Close()
        whr.Send(bytes)
        return whr.Status
    } catch as e {
        return "EX"
    }
}
