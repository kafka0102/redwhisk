const moreImagesBySelect = new WeakMap<object, { current: boolean }>();

export function bindMoreImages(
  selectAttachment: object,
  hasMoreImagesRef: { current: boolean },
): void {
  moreImagesBySelect.set(selectAttachment, hasMoreImagesRef);
}

export function readBoundMoreImages(
  selectAttachment: object | null | undefined,
): boolean {
  if (!selectAttachment) {
    return false;
  }
  return moreImagesBySelect.get(selectAttachment)?.current ?? false;
}
