from sqlalchemy.orm import Session

from demo_api.db import Todo, database_url, make_engine
from demo_api.fixtures import SEED_TODOS


def seed(session: Session) -> int:
    inserted = 0
    for todo_id, title, completed in SEED_TODOS:
        if session.get(Todo, todo_id) is None:
            session.add(Todo(id=todo_id, title=title, completed=completed))
            inserted += 1
    session.commit()
    return inserted


def main() -> None:
    engine = make_engine(database_url())
    try:
        with Session(engine) as session:
            print(f"Inserted {seed(session)} demo TODOs.")
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
