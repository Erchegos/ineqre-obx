# Ticker List Update - January 22, 2026

## Summary

Updated the IBKR daily price update system to use the complete verified ticker list from `packages/ibkr/src/obx-tickers.ts`.

## Changes Made

### 1. Tested All Tickers
Ran comprehensive test of all 59 tickers in the obx-tickers.ts file:
- **✓ 56 tickers working** (including OBX index)
- **✗ 3 tickers failed:** SBNOR, VENDA, VENDB

### 2. Updated Daily Update Script
Updated [scripts/ibkr/daily-update.py](../scripts/ibkr/daily-update.py) with complete working ticker list:

**Before:** 17 tickers (manually maintained subset)
**After:** 56 tickers (all verified working tickers)

### 3. Updated Ticker Reference File
Updated [packages/ibkr/src/obx-tickers.ts](../packages/ibkr/src/obx-tickers.ts):
- Removed failed tickers (SBNOR, VENDA, VENDB)
- Updated header to reflect all tickers are verified
- Alphabetized and reorganized for clarity

## Complete Ticker List (56)

### Index
- **OBX** - OBX Index

### Stocks (55)
1. AFG - AF Gruppen ASA
2. AKER - Aker ASA-A Shares
3. AKRBP - Aker BP ASA
4. ATEA - Atea ASA
5. AUSS - Austevoll Seafood ASA
6. AUTO - Autostore Holdings Ltd
7. BAKKA - Bakkafrost P/F
8. BRG - Borregaard ASA
9. BWLPG - BW LPG Ltd
10. CADLR - Cadeler A/S
11. CMBTO - Cambi Group ASA
12. DNB - DNB Bank ASA
13. DOFG - DOF Group ASA
14. ELK - Elkem ASA
15. ENTRA - Entra ASA
16. EQNR - Equinor ASA
17. FRO - Frontline PLC
18. GJF - Gjensidige Forsikring ASA
19. HAFNI - Hafnia Limited
20. HAUTO - Hurtigruten ASA
21. HAVI - Havila Shipping ASA
22. HEX - Hexagon Composites ASA
23. KIT - Kitron ASA
24. KOG - Kongsberg Gruppen ASA
25. LSG - Lerøy Seafood Group ASA
26. MING - Multiconsult ASA
27. MPCC - MPC Container Ships ASA
28. MOWI - Mowi ASA
29. NAS - Norwegian Air Shuttle ASA
30. NHY - Norsk Hydro ASA
31. NOD - Nordic Semiconductor ASA
32. ODL - Odfjell Drilling Ltd
33. OLT - Oceanteam ASA
34. ORK - Orkla ASA
35. PROT - Protector Forsikring ASA
36. RECSI - REC Silicon ASA
37. SALM - SalMar ASA
38. SB1NO - SpareBank 1 Nord-Norge
39. SCATC - Scatec ASA
40. SNI - Schibsted ASA
41. SPOL - Sparebank 1 Østlandet
42. STB - Storebrand ASA
43. SUBC - Subsea 7 SA
44. SWON - Sbanken ASA
45. TECH - Technip Energies NV
46. TEL - Telenor ASA
47. TGS - TGS ASA
48. TIETO - TietoEVRY Oyj
49. TOM - Tomra Systems ASA
50. VAR - Vår Energi ASA
51. VEI - Veidekke ASA
52. WAWI - Wallenius Wilhelmsen ASA
53. WWI - Wilh. Wilhelmsen Holding ASA
54. WWIB - Wilh. Wilhelmsen Holding B
55. YAR - Yara International ASA

## Removed Tickers

These tickers were in the test list but failed to resolve on IBKR:
- **SBNOR** - SpareBank 1 Nordvest (not found)
- **VENDA** - Veidekke alternative ticker (not found)
- **VENDB** - Veidekke B-shares (not found)

Note: VEI is the working ticker for Veidekke.

## Automatic Updates

The daily update script now:
- Runs every weekday at 6:00 PM
- Fetches data for all 56 tickers
- Updates automatically via launchd (macOS)

Check status: `node scripts/check-prices.js`

## Next Update

The next automatic price update will fetch data for all 56 tickers at 6:00 PM today.

## Files Modified

1. `scripts/ibkr/daily-update.py` - Updated TICKERS list (17 → 56)
2. `packages/ibkr/src/obx-tickers.ts` - Removed failed tickers, updated docs
3. `scripts/ibkr/test-all-tickers.py` - New testing script (created)
