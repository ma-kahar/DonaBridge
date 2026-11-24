// dona-core/src/error.rs
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("Database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("Migration error: {0}")]
    Migration(#[from] rusqlite_migration::Error),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, CoreError>;
