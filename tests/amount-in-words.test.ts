import { describe, expect, it } from "vitest";
import { rupeesInWords } from "@/core/payroll/amount-in-words";

describe("rupeesInWords", () => {
  it("uses lakh and crore", () => {
    expect(rupeesInWords(85000)).toBe("Eighty-Five Thousand Rupees Only");
    expect(rupeesInWords(82258)).toBe("Eighty-Two Thousand Two Hundred Fifty-Eight Rupees Only");
    expect(rupeesInWords(150000)).toBe("One Lakh Fifty Thousand Rupees Only");
    expect(rupeesInWords(12_345_678)).toBe("One Crore Twenty-Three Lakh Forty-Five Thousand Six Hundred Seventy-Eight Rupees Only");
    expect(rupeesInWords(0)).toBe("Zero Rupees Only");
    expect(rupeesInWords(19)).toBe("Nineteen Rupees Only");
  });
});
