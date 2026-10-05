import { test } from "node:test";
import assert from "node:assert/strict";
import { RequestPhotoUploadBody, CompletePhotoUploadBody } from "@workspace/api-zod";
import { matchesPhotoType, MAX_PHOTO_SIZE } from "./photo-validation";

test("upload metadata only accepts supported images within 5 MB", () => {
  const input = { name: "plant.png", size: 100, contentType: "image/png" };
  assert.equal(RequestPhotoUploadBody.safeParse(input).success, true);
  for (const size of [0, -1, MAX_PHOTO_SIZE + 1, 1.5]) {
    assert.equal(RequestPhotoUploadBody.safeParse({ ...input, size }).success, false);
  }
  for (const contentType of ["image/svg+xml", "text/html", "application/octet-stream"]) {
    assert.equal(RequestPhotoUploadBody.safeParse({ ...input, contentType }).success, false);
  }
});

test("photo signatures reject spoofed content types", () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(matchesPhotoType(png, "image/png"), true);
  assert.equal(matchesPhotoType(png, "image/jpeg"), false);
  assert.equal(matchesPhotoType(Buffer.from([255, 216, 255]), "image/jpeg"), true);
  assert.equal(matchesPhotoType(Buffer.from("RIFFxxxxWEBP"), "image/webp"), true);
  for (const type of ["image/jpeg", "image/png", "image/webp"]) {
    assert.equal(matchesPhotoType(Buffer.from("<html>not an image</html>"), type), false);
    assert.equal(matchesPhotoType(Buffer.alloc(0), type), false);
  }
});

test("finalization accepts only generated private photo paths", () => {
  assert.equal(CompletePhotoUploadBody.safeParse({ objectPath: "/objects/photos/00000000-0000-4000-8000-000000000001" }).success, true);
  for (const objectPath of ["/objects/uploads/abc", "/objects/photos/../private", "https://storage.googleapis.com/photo", "data:image/png;base64,abc"]) {
    assert.equal(CompletePhotoUploadBody.safeParse({ objectPath }).success, false);
  }
});
