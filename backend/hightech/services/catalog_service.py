from __future__ import annotations

from dataclasses import asdict, dataclass

from hightech.domain.errors import NotFoundError, ValidationError
from hightech.infrastructure.models import Category, Product
from hightech.infrastructure.unit_of_work import UnitOfWorkFactory


@dataclass(frozen=True)
class ProductData:
    name: str
    retail_price: int
    wholesale_price: int
    category_id: int | None = None
    description: str = ""
    image_url: str | None = None
    retail_offer_price: int | None = None
    wholesale_min_qty: int = 1
    stock: int = 0
    active: bool = True


class CatalogService:
    def __init__(self, uow_factory: UnitOfWorkFactory):
        self._uow = uow_factory

    # --- public catalogue (prices are chosen per program by the presenter)
    def categories(self) -> list[Category]:
        with self._uow() as uow:
            return uow.categories.all()

    def active_products(self, category_id: int | None = None, query: str | None = None) -> list[Product]:
        with self._uow() as uow:
            return uow.products.active(category_id, query)

    def active_product(self, product_id: int) -> Product:
        with self._uow() as uow:
            product = uow.products.get(product_id)
            if product is None or not product.active:
                raise NotFoundError("المنتج غير موجود")
            return product

    # --- dashboard
    def all_products(self) -> list[Product]:
        with self._uow() as uow:
            return uow.products.all()

    def save_product(self, admin_id: int, product_id: int | None, data: ProductData) -> Product:
        with self._uow() as uow:
            if data.category_id is not None and uow.categories.get(data.category_id) is None:
                raise ValidationError("invalid_categoryId", "القسم غير موجود")
            if product_id is None:
                product = uow.products.add(Product(**asdict(data)))
            else:
                product = uow.products.get(product_id)
                if product is None:
                    raise NotFoundError("المنتج غير موجود")
                for key, value in asdict(data).items():
                    setattr(product, key, value)
            uow.session.flush()
            uow.audit.record(admin_id, "save_product", "product", product.id, asdict(data))
            uow.commit()
            return product

    def save_category(self, category_id: int | None, name: str, sort: int) -> Category:
        with self._uow() as uow:
            if category_id is None:
                category = uow.categories.add(Category(name=name, sort=sort))
            else:
                category = uow.categories.get(category_id)
                if category is None:
                    raise NotFoundError("القسم غير موجود")
                category.name, category.sort = name, sort
            uow.commit()
            return category
