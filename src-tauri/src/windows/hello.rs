// windows/hello.rs — Windows Hello biometric verification via WinRT UserConsentVerifier.
// Blueprint §6 & §8 #4: App Lock via PIN (Argon2) or Windows Hello.

use windows::Security::Credentials::UI::{
    UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability,
};

pub async fn is_available() -> bool {
    let Ok(op) = UserConsentVerifier::CheckAvailabilityAsync() else {
        return false;
    };
    matches!(op.get(), Ok(UserConsentVerifierAvailability::Available))
}

pub async fn verify_identity(message: &str) -> anyhow::Result<bool> {
    let msg = windows::core::HSTRING::from(message);
    let op = UserConsentVerifier::RequestVerificationAsync(&msg)?;
    let result = op.get()?;
    Ok(result == UserConsentVerificationResult::Verified)
}
