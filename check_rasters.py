import sys
import rasterio
import numpy as np
from pathlib import Path

def print_raster_info(file_path):
    print(f"\n{'='*50}")
    print(f"Checking Raster: {file_path}")
    print(f"{'='*50}")
    
    try:
        with rasterio.open(file_path) as src:
            print(f"Driver:       {src.driver}")
            print(f"Width:        {src.width}")
            print(f"Height:       {src.height}")
            print(f"Count:        {src.count}")
            print(f"CRS:          {src.crs}")
            
            bounds = src.bounds
            print(f"Bounds:       Left: {bounds.left:.2f}, Bottom: {bounds.bottom:.2f}")
            print(f"              Right: {bounds.right:.2f}, Top: {bounds.top:.2f}")
            
            print(f"Transform:    {src.transform}")
            print(f"NoData Value: {src.nodata}")
            print(f"Dtypes:       {src.dtypes}")
            
            print(f"Is Tiled:     {src.is_tiled}")
            if src.is_tiled:
                print(f"Block Shapes: {src.block_shapes}")
                
            print(f"Overviews:    {[src.overviews(i) for i in src.indexes]}")
            
            # Print stats for each band
            print("\nBand Statistics:")
            for i in src.indexes:
                # Read band, handle nodata
                band = src.read(i)
                if src.nodata is not None:
                    band = np.ma.masked_equal(band, src.nodata)
                    if not band.mask.all():
                        print(f"  Band {i}: Min={band.min():.2f}, Max={band.max():.2f}, Mean={band.mean():.2f}")
                    else:
                        print(f"  Band {i}: All NoData")
                else:
                    print(f"  Band {i}: Min={band.min():.2f}, Max={band.max():.2f}, Mean={band.mean():.2f}")
                    
    except Exception as e:
        print(f"Error reading {file_path}: {e}")


if __name__ == "__main__":
    # If arguments are provided, use those as file paths
    if len(sys.argv) > 1:
        files_to_check = sys.argv[1:]
    else:
        # Otherwise, look for .tif files in a specific directory or current directory
        current_dir = Path(".")
        files_to_check = list(current_dir.glob("*.tif"))
        
        if not files_to_check:
            print("No .tif files found in the current directory.")
            print("Usage: python check_rasters.py <path_to_tif_1> [path_to_tif_2 ...]")
            sys.exit(1)
            
    for f in files_to_check:
        print_raster_info(f)
