"""Demo data. Idempotent: does nothing if an admin already exists."""

from hightech.container import Container
from hightech.domain.enums import MemberStatus, Program
from hightech.domain.money import egp
from hightech.infrastructure.models import Category, Member
from hightech.infrastructure.security import referral_code
from hightech.services.catalog_service import ProductData

CATEGORIES = ["شواحن", "باور بنك", "سماعات", "وصلات"]
PRODUCTS = [  # name, category, retail EGP, wholesale EGP, wholesale min qty
    ("شاحن سريع 20 وات USB-C", "شواحن", 350, 260, 10),
    ("شاحن سيارة 2 منفذ", "شواحن", 220, 160, 10),
    ("باور بنك 10000 مللي أمبير", "باور بنك", 650, 500, 5),
    ("باور بنك 20000 مللي أمبير", "باور بنك", 1000, 780, 5),
    ("سماعة بلوتوث لاسلكية", "سماعات", 900, 680, 5),
    ("سماعة سلك 3.5 مم", "سماعات", 120, 85, 20),
    ("وصلة Type-C إلى Type-C متر", "وصلات", 150, 100, 20),
    ("وصلة Lightning متر", "وصلات", 180, 120, 20),
]
# The example trees written on the two sheets.
RETAIL_CHAIN = ["م. خالد", "أ1", "1.1", "2.1", "3.1", "4.1"]
WHOLESALE_CHAIN = ["ميلانو", "طيب", "مينا"]


def seed(container: Container, admin_password: str) -> str:
    with container.uow() as uow:
        if uow.admins.any():
            return "Database already seeded."
    admin = container.admin_auth.create_admin("admin", admin_password, "مدير النظام")

    with container.uow() as uow:
        categories = {name: uow.categories.add(Category(name=name, sort=i)).id for i, name in enumerate(CATEGORIES)}
        uow.commit()
    for name, category, retail, wholesale, min_qty in PRODUCTS:
        container.catalog.save_product(
            admin.id,
            None,
            ProductData(
                name=name,
                category_id=categories[category],
                retail_price=egp(retail),
                wholesale_price=egp(wholesale),
                wholesale_min_qty=min_qty,
                stock=500,
            ),
        )

    with container.uow() as uow:
        phones = iter(f"+20100{n:07d}" for n in range(1_000_000, 2_000_000))

        def chain(program: Program, names: list[str]) -> None:
            parent_id = None
            for name in names:
                shop = name if program is Program.WHOLESALE else None
                member = uow.members.add(
                    Member(
                        program=program,
                        phone=next(phones),
                        name=name,
                        referral_code=referral_code(program.code_prefix),
                        parent_id=parent_id,
                        status=MemberStatus.ACTIVE,
                        shop_name=shop,
                        shop_address="القاهرة" if shop else None,
                    )
                )
                parent_id = member.id

        chain(Program.RETAIL, RETAIL_CHAIN)
        chain(Program.RETAIL, ["م. رضا"])
        chain(Program.WHOLESALE, WHOLESALE_CHAIN)
        uow.commit()
    return f"Seeded. Admin login: admin / {admin_password}"
