from functools import lru_cache
from typing import Literal
from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
import secrets


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=('.env', '.env.local'), extra='ignore')
    data_mode: Literal['demo', 'postgres'] = 'demo'
    database_url: str = 'postgresql://locateam:locateam@localhost:5432/locateam'
    demo_db: str = 'data/private/demo.db'
    accept_score: float = Field(0.86, ge=0, le=1)
    min_name_score: float = Field(0.78, ge=0, le=1)
    ambiguity_margin: float = Field(0.12, ge=0, le=1)
    candidate_floor: float = Field(0.55, ge=0, le=1)
    cors_origins: list[str] = ['http://localhost:5173', 'http://127.0.0.1:5173']
    requests_per_minute: int = Field(60, ge=1)
    confirmations_per_hour: int = Field(10, ge=1)
    signing_secret: str = ''

    @model_validator(mode='after')
    def secret(self):
        if self.data_mode == 'postgres' and len(self.signing_secret) < 32:
            raise ValueError('Postgres mode requires SIGNING_SECRET with at least 32 characters')
        if not self.signing_secret:
            self.signing_secret = secrets.token_hex(32)
        return self


@lru_cache
def get_settings():
    return Settings()
