# Exporting Manufacturing Packages from EasyEDA (Standard & Pro)

This guide details how to export fabrication Gerbers, BOM, and Pick-and-Place files from EasyEDA Standard and EasyEDA Pro for automated pre-flight review in BoardReadyOps.

---

## 1. EasyEDA Pro Export

### Step 1: Export PCB Fabrication (Gerber & Drill)
1. Open your PCB in EasyEDA Pro.
2. Go to top menu: **File > Export > Fabrication Data (Gerber)**.
3. In the popup window:
   - Check **DRC Check Before Generation**.
   - Ensure layer count and board outline detection match design intent.
4. Click **Export Gerber**. EasyEDA will download `Gerber_<Project>_<Date>.zip`.

### Step 2: Export BOM & Pick-and-Place (Centroid)
1. Go to **File > Export > Pick and Place (CPL)**.
   - Choose CSV format.
   - Click **Export CPL**.
2. Go to **File > Export > Bill of Materials (BOM)**.
   - Select JLCPCB or Standard template.
   - Ensure `Manufacturer Part Number (MPN)`, `LCSC Part #`, and `Designator` columns are filled.
   - Click **Export BOM**.

---

## 2. EasyEDA Standard Export

1. Open your PCB project.
2. Select **Fabrication > PCB Fabrication File (Gerber)** from top menu.
3. When prompted to run DRC, click **Check DRC**. Resolve any fatal shorts or unrouted nets.
4. Click **Generate Gerber** to download the archive.
5. In the same **Fabrication** menu:
   - Select **BOM File (Bill of Materials)** -> Click **Export BOM**.
   - Select **Pick and Place File** -> Click **Export Coordinate**.

---

## 3. Preparing the Upload Archive

1. Combine the exported files into a single clean `.zip` archive:
   ```text
   release_easyeda.zip
   ├── Gerber_PCB.zip (or extracted layer files: .GTL, .GBL, .DRL)
   ├── BOM.csv
   └── Pick_and_Place.csv
   ```
2. Upload to BoardReadyOps via web dropzone or CLI:
   ```bash
   boardreadyops review --archive release_easyeda.zip --cad easyeda
   ```
BoardReadyOps will automatically normalize EasyEDA layer names and JLCPCB part numbers to query live supply intelligence.
