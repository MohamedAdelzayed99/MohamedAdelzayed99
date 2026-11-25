from sqlalchemy import select

from hightech.infrastructure.models import Category, Product

from .base import SqlRepository


class CategoryRepository(SqlRepository[Category]):
    model = Category

    def all(self) -> list[Category]:
        return list(self.session.scalars(select(Category).order_by(Category.sort, Category.name)))

    def by_name(self, name: str) -> Category | None:
        return self.session.scalar(select(Category).where(Category.name == name))


class ProductRepository(SqlRepository[Product]):
    model = Product

    def all(self) -> list[Product]:
        return list(self.session.scalars(select(Product).order_by(Product.id.desc())))

    def active(self, category_id: int | None = None, query: str | None = None) -> list[Product]:
        stmt = select(Product).where(Product.active.is_(True))
        if category_id:
            stmt = stmt.where(Product.category_id == category_id)
        if query:
            stmt = stmt.where(Product.name.contains(query))
        return list(self.session.scalars(stmt.order_by(Product.id.desc()).limit(500)))
