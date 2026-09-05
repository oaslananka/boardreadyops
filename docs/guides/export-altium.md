# Exporting Manufacturing Packages from Altium Designer

This guide details how to generate and export production-ready manufacturing packages from Altium Designer for automated DFM analysis, BOM sourcing risk detection, and client sign-off in BoardReadyOps.

---

## Required Files Checklist

A complete Altium manufacturing package zip bundle must include:

1. **Gerber Files (RS-274X):**
   - Top & Bottom Copper (`.gtl`, `.gbl` or `.g1`, `.g2`, etc.)
   - Top & Bottom Solder Mask (`.gts`, `.gbs`)
   - Top & Bottom Silkscreen (`.gto`, `.gbo`)
   - Board Outline / Mechanical Layer (`.gm1` or `.gko`)
2. **NC Drill Files (Excellon):**
   - Plated and unplated drill holes (`.drl` or `.txt`)
3. **Bill of Materials (BOM):**
   - CSV or Excel (`.csv`) with columns: `Designator`, `Comment` (or Description), `Manufacturer Part Number (MPN)`, `Footprint`, `Quantity`.
4. **Pick-and-Place Centroid:**
   - Text or CSV (`.csv` or `.txt`) with: `Designator`, `Mid X`, `Mid Y`, `Rotation`, `Layer`.

---

## Step 1: Export Gerber RS-274X Files

1. Open your PCB document (`.PcbDoc`) in Altium Designer.
2. Select **File > Fabrication Outputs > Gerber Files**.
3. In the **General** tab:
   - Units: **Inches** or **Millimeters**
   - Format: **2:4** (Inches) or **2:5** (Millimeters)
4. In the **Layers** tab:
   - Click **Plot Layers** and select **Used On**.
   - Ensure the board outline layer (e.g. Mechanical 1) is selected.
5. In the **Apertures** tab:
   - Check **Embedded apertures (RS274X)**.
6. Click **OK** to generate the Gerber files into your project output directory (`/Project Outputs/`).

---

## Step 2: Export NC Drill Files

1. In the same PCB document, select **File > Fabrication Outputs > NC Drill Files**.
2. Configure settings matching your Gerber output:
   - Units: Match the Gerber units (Inches or Millimeters).
   - Format: Match Gerber format (e.g. 2:4 or 2:5).
   - Zero Suppression: Suppress leading zeroes or keep trailing zeroes consistently.
3. Click **OK**, then click **OK** in the Drill Drawing configuration dialog.
4. Altium outputs `.TXT` or `.DRL` files.

---

## Step 3: Export Pick-and-Place Centroids

1. Select **File > Assembly Outputs > Generates pick and place files**.
2. Choose **CSV** format.
3. Units: Metric or Imperial.
4. Click **OK**. Altium will create `Pick Place for <Project>.csv`.

---

## Step 4: Export Structured Bill of Materials (BOM)

1. Select **Reports > Bill of Materials**.
2. In the BOM configuration window:
   - Ensure `Designator`, `Comment`, `Manufacturer Part Number`, `Footprint`, and `Quantity` columns are enabled.
   - Set Export Format to **CSV**.
3. Click **Export** and save as `bom.csv`.

---

## Step 5: Bundle and Ingest

1. Place the generated Gerber files, NC Drill file, BOM CSV, and Centroid file into a single `.zip` archive:
   ```bash
   zip -r altium_release_v1.zip Gerbers/ bom.csv pick_place.csv
   ```
2. Upload the archive directly via the BoardReadyOps web wizard or CLI:
   ```bash
   boardreadyops review --archive altium_release_v1.zip --cad altium
   ```
