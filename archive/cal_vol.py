import pandas as pd
import numpy as np
import geopandas as gpd
import matplotlib.pyplot as plt
from shapely.geometry import Polygon
from pyproj import Transformer
from scipy.spatial import cKDTree

pd.set_option('display.float_format', '{:.10f}'.format)

# -----------------------------
# LOAD GRID DATA
# -----------------------------
df = pd.read_csv(
    "xyz_grid.xyz",
    header=None,
    names=["X", "Y", "Z"],
    sep=","
)

df = df.dropna(subset=["X", "Y", "Z"])
df = df.astype({"X": float, "Y": float, "Z": float})

print("\nBefore Conversion:")
print(df.head())

# -----------------------------
# CONVERT LAT/LONG TO UTM
# -----------------------------
transformer = Transformer.from_crs("epsg:4326", "epsg:32644", always_xy=True)

# Swap (lat, long)
df["X"], df["Y"] = transformer.transform(
    df["X"].values,
    df["Y"].values
)
print("\nAfter Conversion:")
print(df.head())

# -----------------------------
# PRINT RANGE
# -----------------------------
x_max, x_min = df["X"].max(), df["X"].min()
y_max, y_min = df["Y"].max(), df["Y"].min()
z_max, z_min = df["Z"].max(), df["Z"].min()

print(f"\nColumn 1 (X) - Max: {x_max}, Min: {x_min}")
print(f"Column 2 (Y) - Max: {y_max}, Min: {y_min}")
print(f"Column 3 (Z) - Max: {z_max}, Min: {z_min}")

base_height = float(input("\nEnter the base height: "))

# -----------------------------
# CREATE GRID
# -----------------------------
x_grid = np.linspace(x_min, x_max, 25)
y_grid = np.linspace(y_min, y_max, 25)

box_vertices = []
box_boundaries = []
box_areas = []

for i in range(len(x_grid)-1):
    for j in range(len(y_grid)-1):

        x1, x2 = x_grid[i], x_grid[i+1]
        y1, y2 = y_grid[j], y_grid[j+1]

        box_vertices.append([(x1,y1),(x2,y1),(x2,y2),(x1,y2)])
        box_boundaries.append([x1,x2,y1,y2])

        area = (x2-x1)*(y2-y1)
        box_areas.append(area)

# -----------------------------
# FAST KD TREE
# -----------------------------
tree = cKDTree(df[["X","Y"]].values)

box_z_values = []
box_avg_z_values = []
box_volumes = []

for box in box_vertices:
    z_values = []

    for vertex in box:
        dist, idx = tree.query(vertex)
        z_values.append(float(df.iloc[idx]["Z"]))

    box_z_values.append(z_values)

    avg_z = float(np.mean(z_values))
    box_avg_z_values.append(avg_z)

    volume = box_areas[len(box_avg_z_values)-1] * (avg_z-base_height)
    box_volumes.append(volume)

# -----------------------------
# LOAD BOUNDARY
# -----------------------------
gdf = gpd.read_file("boundary.geojson")

# convert boundary
gdf = gdf.to_crs(epsg=32644)

outline_polygon = gdf.geometry.iloc[0].buffer(0)

outline_coords = list(outline_polygon.exterior.coords)
outline_x, outline_y = zip(*outline_coords)

# -----------------------------
# PLOT GRID
# -----------------------------
plt.figure(figsize=(12,10))
ax = plt.gca()

for x in x_grid:
    ax.plot([x,x],[y_min,y_max],color="black",linewidth=0.7)

for y in y_grid:
    ax.plot([x_min,x_max],[y,y],color="black",linewidth=0.7)

ax.plot(outline_x,outline_y,color="red",linewidth=2,label="Boundary")

ax.set_aspect('equal')

# -----------------------------
# INTERSECTION AREA + VOLUME
# -----------------------------
adjusted_areas = []
adjusted_volumes = []

for i, box in enumerate(box_vertices):

    box_polygon = Polygon(box)

    if outline_polygon.intersects(box_polygon):

        intersection = outline_polygon.intersection(box_polygon)

        inter_area = float(intersection.area)

        adjusted_areas.append(inter_area)

        adjusted_volumes.append(
            inter_area*(box_avg_z_values[i]-base_height)
        )
    else:
        adjusted_areas.append(0.0)
        adjusted_volumes.append(0.0)

# -----------------------------
# SAVE RESULTS
# -----------------------------
data = {
    "Box Number": list(range(1,len(box_vertices)+1)),
    "Vertices": box_boundaries,
    "Z-Values": box_z_values,
    "Area (m²)": adjusted_areas,
    "Average Z-Value": box_avg_z_values,
    "Volume (m³)": adjusted_volumes,
}

output_df = pd.DataFrame(data)

total_area = sum(adjusted_areas)
total_volume = sum(adjusted_volumes)
cut_volume = sum(v for v in adjusted_volumes if v>0)

totals_row = pd.DataFrame({
    "Box Number":["Total"],
    "Area (m²)":[total_area],
    "Volume (m³)":[total_volume]
})

cut_row = pd.DataFrame({
    "Box Number":["Cut Volume"],
    "Volume (m³)":[cut_volume]
})

output_df = pd.concat([output_df,totals_row,cut_row],ignore_index=True)

# -----------------------------
# SAVE FILE
# -----------------------------
output_df.to_csv(
    "Giddalur_totalwaste.csv",
    index=False,
    encoding="utf-8-sig"
)

output_df.to_excel(
    "Giddalur_totalwaste.xlsx",
    index=False
)

print("\n✅ Data saved successfully")
print("Cut Volume:",cut_volume,"m³")

# -----------------------------
# LABEL GRID
# -----------------------------
for i,box in enumerate(box_vertices):

    cx=(box[0][0]+box[2][0])/2
    cy=(box[0][1]+box[2][1])/2

    plt.text(cx,cy,f"Box{i+1}",fontsize=4,ha="center")

plt.xlabel("X (meters)")
plt.ylabel("Y (meters)")
plt.title("20x20 Grid with Boundary")
plt.legend()
plt.grid(True)
plt.tight_layout()
plt.show()