export function receiptObjectKey(ownerId: string, receiptId: string): string {
  return `receipts/${ownerId}/${receiptId}`;
}
