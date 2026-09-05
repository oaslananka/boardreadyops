# Exporting Manufacturing Packages from Autodesk Fusion Electronics

This guide details how to configure the CAM Processor and generate comprehensive fabrication packages in Autodesk Fusion Electronics (formerly EAGLE) for verification in BoardReadyOps.

---

## 1. Configuring the CAM Processor

1. In Autodesk Fusion, open your Electronics Design and switch to the **PCB Layout** document.
2. In the top toolbar, click **Manufacturing > CAM Processor**.
3. In the CAM Processor dialog:
   - Select the output preset: **Gerber (RS-274X)** or your fabricator's CAM template.
   - Verify that all active copper layers, solder mask, silkscreen, and Profile / Outline (Dimension layer 20) are mapped to output sections.
4. Check the **Drill** section:
   - Ensure **Excellon** is selected for plated and unplated holes.
5. In the top right, click **Process Job**.
6. Fusion will create a zip file or a folder containing your Gerbers and drill files (`CAMOutputs/`).

---

## 2. Exporting the Bill of Materials (BOM)

1. Return to the PCB or Schematic document.
2. Select **Manufacturing > BOM** (or run `run bom` in the command line).
3. In the Bill of Materials dialog:
   - Choose **Values** or **Parts** view.
   - Ensure `Parts` (Designators), `Value`, `Device`, `Package`, and custom attribute `MPN` (Manufacturer Part Number) are displayed.
   - Select Output format: **CSV**.
4. Click **Save** and name the file `bom.csv`.

---

## 3. Exporting Pick-and-Place (Centroid / Mounting) Data

1. In PCB layout view, go to **Automation > Run ULP** (User Language Program).
2. Type or select `mountsmd.ulp`.
3. Click **OK**.
4. The script outputs two files:
   - `<Project>.mnt` (Top side SMD components)
   - `<Project>.mnb` (Bottom side SMD components)
5. Alternatively, run `mount.ulp` to get a combined CSV containing both sides.

---

## 4. Packing and Uploading to BoardReadyOps

1. Create a zip archive containing:
   - All `.gbr` / `.ger` / `.drl` files from `CAMOutputs/`
   - `bom.csv`
   - `<Project>.mnt` / `<Project>.mnb` (or combined centroid CSV)
2. Submit the archive to BoardReadyOps:
   ```bash
   boardreadyops review --archive fusion360_rev1.zip --cad fusion360
   ```
BoardReadyOps parses EAGLE/Fusion attribute fields, mirrors bottom layer centroid coordinates accurately, and flags spacing/annular ring issues.
