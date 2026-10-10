import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import { InventoryError } from "@sellerone/inventory-service";

export async function decodeCatalogueImage(value: unknown): Promise<Buffer> {
  const match = typeof value === "string" ? /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value) : null;
  if (!match) throw new InventoryError("Upload a PNG, JPEG or WebP product image.", 400);
  const input = Buffer.from(match[2], "base64");
  if (input.length > 5 * 1024 * 1024) throw new InventoryError("Each product image must be no larger than 5 MB.", 413);
  if (!input.length || input.toString("base64") !== match[2]) throw new InventoryError("Product image encoding is invalid.", 400);
  try {
    const decoder = sharp(input, { limitInputPixels: 4096 * 4096, failOn: "warning" });
    const metadata = await decoder.metadata();
    if (metadata.format !== match[1] || !metadata.width || !metadata.height || metadata.width > 4096 || metadata.height > 4096 || (metadata.pages ?? 1) !== 1) {
      throw new InventoryError("Use single-frame product images no larger than 4096 x 4096 pixels.", 400);
    }
    return await decoder.rotate().resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
  } catch (error) {
    if (error instanceof InventoryError) throw error;
    throw new InventoryError("Product image could not be decoded. Use a valid PNG, JPEG or WebP within 4096 x 4096 pixels.", 400);
  }
}

export class CatalogueMetadata {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS product_categories (
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      category TEXT NOT NULL, PRIMARY KEY(product_id, category)
    );
    CREATE TABLE IF NOT EXISTS product_images (
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      position INTEGER NOT NULL, image BLOB NOT NULL, version TEXT NOT NULL,
      PRIMARY KEY(product_id, position)
    );`);
  }
  enrich(product: object): object {
    if (!("id" in product) || typeof product.id !== "string") throw new Error("Invalid catalogue product.");
    const id = product.id;
    const status = this.db.prepare("SELECT status FROM product_lifecycle WHERE product_id = ?").get(id)?.status;
    return { ...product, lifecycleStatus: status ?? ("active" in product && product.active ? "active" : "archived"), categories: this.db.prepare("SELECT category FROM product_categories WHERE product_id = ? ORDER BY category").all(id).map((row) => String(row.category)),
      images: this.db.prepare("SELECT position, version FROM product_images WHERE product_id = ? ORDER BY position").all(id).map((row) => `/api/product-images/${encodeURIComponent(id)}/${row.position}?v=${row.version}`) };
  }
  async prepare(body: Record<string, unknown>, id?: string): Promise<{ categories?: string[]; images?: Buffer[] }> {
    let categories: string[] | undefined;
    if (body.categories !== undefined) {
      if (!Array.isArray(body.categories) || body.categories.length > 20 || body.categories.some((value) => typeof value !== "string" || !value.trim() || value.length > 100)) throw new InventoryError("Use up to 20 non-empty categories, each at most 100 characters.", 400);
      categories = body.categories.map((value: string) => value.trim());
      if (new Set(categories.map((value) => value.toLowerCase())).size !== categories.length) throw new InventoryError("Categories must be unique.", 400);
    }
    let images: Buffer[] | undefined;
    if (body.images !== undefined) {
      if (!Array.isArray(body.images) || body.images.length > 3) throw new InventoryError("Use at most three product images.", 400);
      images = [];
      for (const value of body.images) {
        if (typeof value === "string" && value.startsWith("/api/product-images/") && id) {
          const rows = this.db.prepare("SELECT position, image, version FROM product_images WHERE product_id = ?").all(id);
          const row = rows.find((entry) => value === `/api/product-images/${encodeURIComponent(id)}/${entry.position}?v=${entry.version}`);
          if (!row || !(row.image instanceof Uint8Array)) throw new InventoryError("Saved product image is invalid or belongs to another product.", 400);
          images.push(Buffer.from(row.image));
        } else images.push(await decodeCatalogueImage(value));
      }
    }
    return { categories, images };
  }
  save(id: string, data: { categories?: string[]; images?: Buffer[] }): void {
    if (data.categories) {
      this.db.prepare("DELETE FROM product_categories WHERE product_id = ?").run(id);
      for (const category of data.categories) this.db.prepare("INSERT INTO product_categories VALUES (?, ?)").run(id, category);
    }
    if (data.images) {
      this.db.prepare("DELETE FROM product_images WHERE product_id = ?").run(id);
      data.images.forEach((image, position) => this.db.prepare("INSERT INTO product_images VALUES (?, ?, ?, ?)").run(id, position, image, createHash("sha256").update(image).digest("hex")));
    }
  }
  image(id: string, position: string): Uint8Array {
    const row = this.db.prepare("SELECT image FROM product_images WHERE product_id = ? AND position = ?").get(id, position);
    if (!row) throw new InventoryError("Product image not found.", 404);
    if (!(row.image instanceof Uint8Array)) throw new Error("Stored product image is invalid.");
    return row.image;
  }
}
