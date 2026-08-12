import rasterio
import numpy as np
from pathlib import Path


def inspect_raster(file_path):
    try:
        with rasterio.open(file_path) as src:
            bounds = src.bounds
            min_elev = None

            # Get EPSG if available
            epsg = src.crs.to_epsg() if src.crs else None

            # Sample elevation for DSM/DTM
            if src.count == 1:
                small_band = src.read(1, out_shape=(500, 500))

                if src.nodata is not None:
                    small_band = np.ma.masked_equal(small_band, src.nodata)

                if hasattr(small_band, "mask"):
                    if not small_band.mask.all():
                        min_elev = float(small_band.min())
                else:
                    min_elev = float(small_band.min())

            return {
                "file": str(file_path),
                "left": round(bounds.left, 2),
                "right": round(bounds.right, 2),
                "bottom": round(bounds.bottom, 2),
                "top": round(bounds.top, 2),
                "min_elev": round(min_elev, 1) if min_elev is not None else None,
                "crs": str(src.crs),
                "epsg": epsg,
                "tiled": src.is_tiled,
            }

    except Exception as e:
        print(f"\n❌ Error reading file:\n{e}")
        return None


def main():
    print("=" * 60)
    print("⚡ INSTANT RASTER INSPECTOR")
    print("=" * 60)

    print("\nPaste one or more TIFF file paths.")
    print("Press Enter on an empty line when finished.\n")

    files = []n

    while True:
        path = input("TIFF Path: ").strip().strip('"')

        if path == "":
            break

        if Path(path).exists():
            files.append(path)
        else:
            print("❌ File not found.")

    if not files:
        print("No files selected.")
        return

    results = []
    dsm_info = None
    ortho_info = None

    for f in files:
        info = inspect_raster(f)

        if info:
            results.append(info)

            if info["min_elev"] is not None:
                dsm_info = info
            else:
                ortho_info = info

    print("\n" + "=" * 60)

    for res in results:
        print(f"\n📄 File: {Path(res['file']).name}")
        print(f"Full Path : {res['file']}")
        print(f"EPSG      : {res['epsg']}")
        print(f"CRS       : {res['crs']}")
        print(f"Tiled COG : {res['tiled']}")
        print(f"Bounds    :")
        print(f"   Left   : {res['left']}")
        print(f"   Right  : {res['right']}")
        print(f"   Bottom : {res['bottom']}")
        print(f"   Top    : {res['top']}")

        if res["min_elev"] is not None:
            print(f"Min Elev. : {res['min_elev']} m")

    ref_info = dsm_info or ortho_info

    if ref_info:
        survey_name = "july_2026"
        z_offset = dsm_info["min_elev"] if dsm_info else 429

        print("\n" + "=" * 60)
        print("SER.JS CONFIG")
        print("=" * 60)

        print(f"""
{survey_name}: {{
    elevationUrl: "./projects/<FOLDER_NAME>/surveys/{survey_name}/DSM_cloudoptimised.tif",
    orthoUrl: "./projects/<FOLDER_NAME>/surveys/{survey_name}/Ortho_CO.tif",
    extent: [{ref_info['left']}, {ref_info['right']}, {ref_info['bottom']}, {ref_info['top']}],
    zOffset: {z_offset}
}}
""")

    input("\nPress Enter to exit...")


if __name__ == "__main__":
    main()