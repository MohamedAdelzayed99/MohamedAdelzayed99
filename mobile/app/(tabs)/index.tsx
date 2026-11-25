import { useMemo, useState } from "react";
import { FlatList, Image, Pressable, Text, View, useWindowDimensions } from "react-native";
import type { Category, Product } from "../../src/api";
import { useAuth } from "../../src/auth";
import { minQty, useCart } from "../../src/cart";
import { colors, IS_RETAIL } from "../../src/config";
import { useCached } from "../../src/useCached";
import { Banner, Chip, Empty, Field, money, P, Row } from "../../src/ui";

export default function Products() {
  const { member } = useAuth();
  const { add, lines } = useCart();
  const products = useCached<Product[]>("/products", "products");
  const categories = useCached<Category[]>("/categories", "categories");
  const [cat, setCat] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const { width } = useWindowDimensions();
  const cols = width > 700 ? 3 : 2;

  const list = useMemo(
    () => (products.data ?? []).filter((p) => (cat === null || p.categoryId === cat) && (!q || p.name.includes(q.trim()))),
    [products.data, cat, q],
  );

  const header = (
    <View style={{ gap: 10, paddingBottom: 6 }}>
      {member?.status === "pending_approval" ? (
        <Banner tone="warn">حساب المحل في انتظار التفعيل من الإدارة. يمكنك تصفح الأسعار، والطلب بعد التفعيل.</Banner>
      ) : null}
      {products.stale && products.data ? <Banner>تعرض آخر نسخة محفوظة — {products.error}</Banner> : null}
      <Field placeholder="ابحث عن منتج..." value={q} onChangeText={setQ} testID="search" />
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={[{ id: null as number | null, name: "الكل" }, ...(categories.data ?? [])]}
        keyExtractor={(c) => String(c.id)}
        contentContainerStyle={{ gap: 8 }}
        renderItem={({ item }) => <Chip label={item.name} active={cat === item.id} onPress={() => setCat(item.id)} />}
      />
    </View>
  );

  return (
    <FlatList
      key={cols}
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 12, gap: 10 }}
      columnWrapperStyle={{ gap: 10 }}
      numColumns={cols}
      data={list}
      keyExtractor={(p) => String(p.id)}
      ListHeaderComponent={header}
      ListEmptyComponent={products.loading && !products.data ? <P muted>جارِ التحميل...</P> : <Empty text="لا توجد منتجات" />}
      refreshing={products.loading}
      onRefresh={() => { products.refresh(); categories.refresh(); }}
      renderItem={({ item }) => {
        const inCart = lines.find((l) => l.product.id === item.id)?.qty ?? 0;
        return (
          <View style={{ flex: 1 / cols, backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}>
            <View style={{ height: 110, backgroundColor: "#e8eef8", alignItems: "center", justifyContent: "center" }}>
              {item.imageUrl ? (
                <Image source={{ uri: item.imageUrl }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
              ) : (
                <Text style={{ fontSize: 36 }}>📱</Text>
              )}
            </View>
            <View style={{ padding: 10, gap: 4, flex: 1 }}>
              <P bold style={{ fontSize: 14 }}>{item.name}</P>
              <Row style={{ flexWrap: "wrap" }}>
                <Text style={{ color: colors.blue, fontWeight: "800", fontSize: 16 }}>{money(item.price)}</Text>
                {item.originalPrice ? (
                  <Text style={{ color: colors.muted, textDecorationLine: "line-through", fontSize: 13 }}>{money(item.originalPrice)}</Text>
                ) : null}
              </Row>
              {!IS_RETAIL ? <P muted style={{ fontSize: 13 }}>{`أقل كمية: ${minQty(item)}`}</P> : null}
              <View style={{ flex: 1 }} />
              <Pressable
                disabled={!item.inStock}
                onPress={() => add(item, IS_RETAIL ? 1 : inCart ? 1 : minQty(item))}
                style={{ backgroundColor: item.inStock ? colors.navy : colors.border, borderRadius: 10, paddingVertical: 9, alignItems: "center", marginTop: 4 }}
                testID={`add-${item.id}`}
              >
                <Text style={{ color: "#fff", fontWeight: "700" }}>
                  {!item.inStock ? "غير متوفر" : inCart ? `في السلة (${inCart}) +` : "أضف للسلة"}
                </Text>
              </Pressable>
            </View>
          </View>
        );
      }}
    />
  );
}
