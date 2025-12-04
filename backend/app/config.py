from pydantic_settings import BaseSettings
from typing import Optional
import os


class Settings(BaseSettings):
    # Database
    database_url: str = "sqlite+aiosqlite:///./data/organizer.db"
    
    # App settings
    app_name: str = "AI Paperless Organizer"
    debug: bool = False
    
    class Config:
        env_file = ".env"
        extra = "allow"


settings = Settings()

