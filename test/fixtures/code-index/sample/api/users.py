import os
from db.session import (
    get_session,
    close_session,
)
from fastapi import FastAPI

app = FastAPI()


class UserService:
    """Manages user lifecycle."""

    def create_user(self, name):
        session = get_session()
        close_session(session)
        return save(session, name)


def save(session, name):
    print(os.getenv("APP_ENV"), session)
    return name


@app.get("/users/{user_id}")
async def get_user(user_id: int):
    """Fetch one user."""
    return get_session()
