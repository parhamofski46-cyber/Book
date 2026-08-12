'use strict';

const { db } = require('./index');

/**
 * همه‌ی پرس‌وجوهای دیتابیس در یک جا.
 * صفحات عمومی سایت مستقیماً از این توابع می‌خوانند؛ چون SQLite روی همان
 * سرور است، خواندن در حد میکروثانیه طول می‌کشد و صفحه سریع رندر می‌شود.
 */

// ---------------------------------------------------------------- دسته‌ها

const listCategories = () =>
  db
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM products p
                WHERE p.category_id = c.id AND p.is_active = 1) AS product_count
         FROM categories c
        ORDER BY c.sort_order, c.id`
    )
    .all();

const getCategoryBySlug = (slug) =>
  db.prepare('SELECT * FROM categories WHERE slug = ?').get(slug);

const getCategoryById = (id) => db.prepare('SELECT * FROM categories WHERE id = ?').get(id);

const listSubcategories = (categoryId) =>
  db
    .prepare('SELECT * FROM subcategories WHERE category_id = ? ORDER BY sort_order, id')
    .all(categoryId);

const listAllSubcategories = () =>
  db
    .prepare(
      `SELECT s.*, c.slug AS category_slug, c.name AS category_name
         FROM subcategories s JOIN categories c ON c.id = s.category_id
        ORDER BY c.sort_order, s.sort_order`
    )
    .all();

// -------------------------------------------------------------- محصولات

// ستون‌های مشترک + عکس اصلی محصول (کم‌ترین sort_order)
const PRODUCT_SELECT = `
  SELECT p.*,
         c.name AS category_name,
         c.slug AS category_slug,
         s.name AS subcategory_name,
         s.slug AS subcategory_slug,
         (SELECT basename FROM product_images i
           WHERE i.product_id = p.id ORDER BY i.sort_order, i.id LIMIT 1) AS image,
         (SELECT alt FROM product_images i
           WHERE i.product_id = p.id ORDER BY i.sort_order, i.id LIMIT 1) AS image_alt
    FROM products p
    JOIN categories c    ON c.id = p.category_id
    LEFT JOIN subcategories s ON s.id = p.subcategory_id
`;

/**
 * فهرست محصولات با فیلترهای اختیاری.
 * @param {{category?: string, subcategory?: string, q?: string, onlyInStock?: boolean,
 *          includeInactive?: boolean, limit?: number}} opts
 */
function listProducts(opts = {}) {
  const where = [];
  const params = {};

  if (!opts.includeInactive) where.push('p.is_active = 1');
  if (opts.category) {
    where.push('c.slug = @category');
    params.category = opts.category;
  }
  if (opts.subcategory) {
    where.push('s.slug = @subcategory');
    params.subcategory = opts.subcategory;
  }
  if (opts.onlyInStock) where.push('p.in_stock = 1');
  if (opts.q) {
    where.push('(p.name LIKE @q OR p.summary LIKE @q OR p.description LIKE @q)');
    params.q = `%${opts.q}%`;
  }

  const sql = `${PRODUCT_SELECT}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY p.in_stock DESC, p.sort_order, p.id DESC
    ${opts.limit ? 'LIMIT @limit' : ''}`;

  if (opts.limit) params.limit = opts.limit;
  return db.prepare(sql).all(params);
}

const getProductBySlug = (slug) =>
  db.prepare(`${PRODUCT_SELECT} WHERE p.slug = @slug`).get({ slug });

const getProductById = (id) => db.prepare(`${PRODUCT_SELECT} WHERE p.id = @id`).get({ id });

const listProductImages = (productId) =>
  db
    .prepare('SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order, id')
    .all(productId);

/** محصولات مرتبط (هم‌دسته) برای پایین صفحه‌ی محصول */
const relatedProducts = (product, limit = 4) =>
  db
    .prepare(
      `${PRODUCT_SELECT} WHERE p.is_active = 1 AND p.category_id = @cat AND p.id <> @id
        ORDER BY p.in_stock DESC, p.sort_order LIMIT @limit`
    )
    .all({ cat: product.category_id, id: product.id, limit });

// ------------------------------------------------------- آمار پنل مدیریت

const adminStats = () => ({
  products: db.prepare('SELECT COUNT(*) n FROM products').get().n,
  active: db.prepare('SELECT COUNT(*) n FROM products WHERE is_active = 1').get().n,
  outOfStock: db.prepare('SELECT COUNT(*) n FROM products WHERE in_stock = 0').get().n,
  noImage: db
    .prepare(
      'SELECT COUNT(*) n FROM products p WHERE NOT EXISTS (SELECT 1 FROM product_images i WHERE i.product_id = p.id)'
    )
    .get().n,
  categories: db.prepare('SELECT COUNT(*) n FROM categories').get().n,
});

module.exports = {
  listCategories,
  getCategoryBySlug,
  getCategoryById,
  listSubcategories,
  listAllSubcategories,
  listProducts,
  getProductBySlug,
  getProductById,
  listProductImages,
  relatedProducts,
  adminStats,
};
