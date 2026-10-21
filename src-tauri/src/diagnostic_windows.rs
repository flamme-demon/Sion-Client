//! Configuration WER par un auxiliaire du même exécutable, élevé uniquement
//! le temps de modifier la clé de Sion. Aucun traitement dans un tas corrompu.
use std::io;
use std::os::windows::ffi::OsStrExt;

use winreg::enums::*;
use winreg::{RegKey, RegValue};

const CLE: &str = r"SOFTWARE\Microsoft\Windows\Windows Error Reporting\LocalDumps\sion-client.exe";
const DOSSIER: &str = r"%LOCALAPPDATA%\com.sion.client\CrashDumps";
const PROPRIETAIRE: &str = "SionDiagnosticVersion";
const SAUVEGARDE: &str = "SionDiagnosticBackup";
const VALEURS: [&str; 3] = ["DumpFolder", "DumpType", "DumpCount"];
const ARGUMENT: &str = "--sion-diagnostic-windows";

fn ouvrir() -> io::Result<RegKey> {
    RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey_with_flags(CLE, KEY_READ | KEY_WOW64_64KEY)
}

fn geree(cle: &RegKey) -> bool {
    cle.get_value::<u32, _>(PROPRIETAIRE).ok() == Some(1)
}

pub fn capture_active() -> bool {
    let Ok(cle) = ouvrir() else { return false };
    cle.get_value::<u32, _>("DumpType").ok() == Some(2)
        && cle
            .get_value::<String, _>("DumpFolder")
            .is_ok_and(|v| v.eq_ignore_ascii_case(DOSSIER))
}

fn supprimer_valeur(cle: &RegKey, nom: &str) -> io::Result<()> {
    match cle.delete_value(nom) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        resultat => resultat,
    }
}

fn desactiver() -> io::Result<()> {
    let machine = RegKey::predef(HKEY_LOCAL_MACHINE);
    let cle = match machine.open_subkey_with_flags(CLE, KEY_ALL_ACCESS | KEY_WOW64_64KEY) {
        Ok(cle) => cle,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e),
    };
    if !geree(&cle) {
        return Ok(());
    }
    let sauvegarde = cle.open_subkey(SAUVEGARDE)?;
    let existait: u32 = sauvegarde.get_value("KeyExisted")?;
    for nom in VALEURS {
        match sauvegarde.get_raw_value(nom) {
            Ok(valeur) => cle.set_raw_value(nom, &valeur)?,
            Err(e) if e.kind() == io::ErrorKind::NotFound => supprimer_valeur(&cle, nom)?,
            Err(e) => return Err(e),
        }
    }
    drop(sauvegarde);
    cle.delete_subkey_all(SAUVEGARDE)?;
    supprimer_valeur(&cle, PROPRIETAIRE)?;
    // Une clé créée par Sion et redevenue vide ne doit pas activer les
    // valeurs WER par défaut. D'éventuels réglages étrangers sont conservés.
    if existait == 0 && cle.enum_values().next().is_none() && cle.enum_keys().next().is_none() {
        drop(cle);
        machine.delete_subkey_with_flags(CLE, KEY_WOW64_64KEY)?;
    }
    Ok(())
}

fn activer() -> io::Result<()> {
    let machine = RegKey::predef(HKEY_LOCAL_MACHINE);
    let (cle, disposition) =
        machine.create_subkey_with_flags(CLE, KEY_ALL_ACCESS | KEY_WOW64_64KEY)?;
    if !geree(&cle) {
        // Reprendre le petit kit .reg diffusé avant la 2.0.2. Son arrêt
        // doit réellement retirer la capture, pas restaurer le même réglage.
        let ancien_kit = capture_active()
            && cle.get_value::<u32, _>("DumpCount").ok() == Some(2)
            && cle.enum_keys().next().is_none()
            && cle
                .enum_values()
                .all(|v| v.is_ok_and(|(nom, _)| VALEURS.contains(&nom.as_str())));
        let (sauvegarde, _) = cle.create_subkey(SAUVEGARDE)?;
        sauvegarde.set_value(
            "KeyExisted",
            &u32::from(disposition == REG_OPENED_EXISTING_KEY && !ancien_kit),
        )?;
        for nom in VALEURS {
            if ancien_kit {
                supprimer_valeur(&sauvegarde, nom)?;
                continue;
            }
            match cle.get_raw_value(nom) {
                Ok(valeur) => sauvegarde.set_raw_value(nom, &valeur)?,
                Err(e) if e.kind() == io::ErrorKind::NotFound => {
                    supprimer_valeur(&sauvegarde, nom)?
                }
                Err(e) => return Err(e),
            }
        }
        cle.set_value(PROPRIETAIRE, &1u32)?;
    }
    let dossier = RegValue {
        bytes: DOSSIER
            .encode_utf16()
            .chain(Some(0))
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<_>>()
            .into(),
        vtype: REG_EXPAND_SZ,
    };
    let resultat = (|| {
        cle.set_raw_value("DumpFolder", &dossier)?;
        cle.set_value("DumpCount", &2u32)?;
        cle.set_value("DumpType", &2u32)?;
        Ok(())
    })();
    if resultat.is_err() {
        let _ = desactiver();
    }
    resultat
}

fn appliquer(active: bool) -> io::Result<()> {
    if active {
        activer()
    } else {
        if capture_active() && ouvrir().is_ok_and(|cle| !geree(&cle)) {
            activer()?;
        }
        desactiver()
    }
}

/// Appelé avant la construction de Tauri ; arguments fermés, aucun chemin
/// ni commande arbitraire ne peut être transmis à l'auxiliaire administrateur.
pub fn gerer_commande() -> Option<i32> {
    let args: Vec<_> = std::env::args_os().collect();
    if args.get(1).is_none_or(|arg| arg != ARGUMENT) {
        return None;
    }
    let active = match args.get(2).and_then(|a| a.to_str()) {
        Some("activer") if args.len() == 3 => true,
        Some("desactiver") if args.len() == 3 => false,
        _ => return Some(2),
    };
    Some(match appliquer(active) {
        Ok(()) => 0,
        Err(e) => e.raw_os_error().unwrap_or(1),
    })
}

pub fn configurer(active: bool) -> Result<(), String> {
    if active && capture_active() && ouvrir().is_ok_and(|cle| geree(&cle)) {
        return Ok(());
    }
    if !active && !capture_active() && !ouvrir().is_ok_and(|cle| geree(&cle)) {
        return Ok(());
    }
    match appliquer(active) {
        Ok(()) => return Ok(()),
        Err(e) if e.kind() != io::ErrorKind::PermissionDenied => return Err(e.to_string()),
        Err(_) => {}
    }
    // L'IPC attend ce thread, pas le fil de l'interface. L'app entière
    // continue à tourner avec les droits ordinaires pendant l'UAC.
    std::thread::spawn(move || elever(active))
        .join()
        .map_err(|_| "L'auxiliaire de diagnostic s'est interrompu.".to_string())?
}

fn elever(active: bool) -> Result<(), String> {
    use windows::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
    use windows::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject, INFINITE};
    use windows::Win32::UI::Shell::{
        ShellExecuteExW, SEE_MASK_FLAG_NO_UI, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
    };
    use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;
    use windows_core::PCWSTR;

    struct Appartement;
    impl Drop for Appartement {
        fn drop(&mut self) {
            unsafe { CoUninitialize() };
        }
    }
    unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }
        .ok()
        .map_err(|e| e.to_string())?;
    let _appartement = Appartement;
    let exe: Vec<u16> = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let verbe: Vec<u16> = "runas".encode_utf16().chain(Some(0)).collect();
    let parametres: Vec<u16> = format!(
        "{ARGUMENT} {}",
        if active { "activer" } else { "desactiver" }
    )
    .encode_utf16()
    .chain(Some(0))
    .collect();
    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_FLAG_NO_UI,
        lpVerb: PCWSTR(verbe.as_ptr()),
        lpFile: PCWSTR(exe.as_ptr()),
        lpParameters: PCWSTR(parametres.as_ptr()),
        nShow: SW_HIDE.0,
        ..Default::default()
    };
    unsafe { ShellExecuteExW(&mut info) }.map_err(|e| {
        if e.code().0 as u32 == 0x800704c7 {
            "diagnostic_permission_refusee".to_string()
        } else {
            e.to_string()
        }
    })?;
    if info.hProcess.is_invalid() {
        return Err("Windows n'a pas fourni le processus de configuration.".into());
    }
    struct Processus(windows::Win32::Foundation::HANDLE);
    impl Drop for Processus {
        fn drop(&mut self) {
            let _ = unsafe { CloseHandle(self.0) };
        }
    }
    let processus = Processus(info.hProcess);
    if unsafe { WaitForSingleObject(processus.0, INFINITE) } != WAIT_OBJECT_0 {
        return Err("La configuration Windows n'a pas pu être suivie.".into());
    }
    let mut code = 1;
    unsafe { GetExitCodeProcess(processus.0, &mut code) }.map_err(|e| e.to_string())?;
    if code != 0 {
        return Err(format!("Configuration Windows impossible (code {code})."));
    }
    if active && !capture_active() {
        return Err("Windows n'a pas conservé la configuration de capture.".into());
    }
    Ok(())
}

pub fn memoire_residente() -> Option<u64> {
    use windows::Win32::System::ProcessStatus::{K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
    use windows::Win32::System::Threading::GetCurrentProcess;
    let taille = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
    let mut compteurs = PROCESS_MEMORY_COUNTERS {
        cb: taille,
        ..Default::default()
    };
    unsafe { K32GetProcessMemoryInfo(GetCurrentProcess(), &mut compteurs, taille) }
        .as_bool()
        .then_some(compteurs.WorkingSetSize as u64)
}
